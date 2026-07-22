#!/usr/bin/env node
'use strict';

/**
 * Tension/excitement proxy measurer (separate concern from
 * tools/playtest.js's win-rate/reachability balance checks).
 *
 * Drives the real game the same way playtest.js does, but instruments each
 * run for objective proxies of "hara-hara" tension rather than balance:
 *   - near-death survivals in WON runs (HP dipping below 20% of max, then
 *     surviving)
 *   - heartbreak-closeness in LOST runs (floor reached vs MAX_FLOOR, and
 *     enemy HP % remaining at the moment the player died)
 *   - clutch blocks (turns where block vs incoming enemy atk was a close
 *     margin, i.e. barely enough or barely not enough)
 *   - run-to-run variance in floorReached
 *   - reward-decision closeness (score gap between best/second-best of the
 *     3 offered cards), plus data to reason about whether the new "remove a
 *     card" 4th option ever plausibly beats all 3 adds (deck bloat / chaff
 *     count at the moment of each reward screen)
 *
 * The bot itself never "feels" tension - these are mechanical proxies. The
 * claim is only: if even a greedy bot's play is full of near-death saves,
 * high variance, and close decisions, a human playing the same game is very
 * likely to feel tension too; if the bot never sees any of that, a human
 * probably won't either.
 *
 * Usage:
 *   node tools/tension-check.js [runsPerDifficulty] [difficulty]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_URL = 'file://' + path.join(REPO_ROOT, 'index.html');

const ALL_DIFFICULTIES = ['easy', 'normal', 'hard'];
const DEFAULT_RUNS = 20;
const MAX_TURNS = 500;
const NEAR_DEATH_RATIO = 0.2;
const CLUTCH_MARGIN = 3;

const CCR_CHROMIUM = '/opt/pw-browsers/chromium';

async function playOneRun(page, difficulty) {
  await page.evaluate((diff) => newGame(diff), difficulty);

  const attackEvents = []; // per enemy attack: block, atk, dmgTaken, hpBefore, hpAfter, maxHp
  const rewardEvents = []; // per reward screen: offeredScores, deckSize, worstDeckScore, chaffCount, floor

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const snap = await page.evaluate(() => ({ gameOver: state.gameOver, mode: state.mode }));

    if (snap.gameOver) {
      const final = await page.evaluate(() => ({
        won: state.floor >= MAX_FLOOR,
        floor: state.floor,
        enemyHp: state.enemy ? state.enemy.hp : null,
        enemyMaxHp: state.enemy ? state.enemy.maxHp : null,
      }));
      return {
        difficulty, won: final.won, floorReached: final.floor,
        enemyHpAtDeath: final.enemyHp, enemyMaxHpAtDeath: final.enemyMaxHp,
        attackEvents, rewardEvents,
      };
    }

    if (snap.mode === 'reward') {
      const info = await page.evaluate(() => {
        // コスト効率で採点。旧式はコストを1回引くだけで、コストに比例
        // しない値の大きさそのものを過大評価するバイアスがあった。
        function scoreCard(c) {
          const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5;
          return raw / Math.max(c.cost, 0.5);
        }
        const cards = Array.from(document.querySelectorAll('#rewardCards .card'));
        const offeredScores = cards.map((el) => scoreCard(CARD_LIBRARY[el.dataset.cardId]));
        const deckScores = state.player.deck.map((id) => scoreCard(CARD_LIBRARY[id]));
        return {
          floor: state.floor,
          offeredScores,
          deckSize: state.player.deck.length,
          worstDeckScore: deckScores.length ? Math.min(...deckScores) : null,
          avgDeckScore: deckScores.length ? deckScores.reduce((a, b) => a + b, 0) / deckScores.length : null,
          chaffCount: deckScores.filter((s) => s <= 6).length,
        };
      });
      rewardEvents.push(info);

      // Baseline bot: always adds the best-scoring of the 3 offered cards,
      // never uses the remove option (matches playtest.js's existing bot).
      await page.evaluate(() => {
        // コスト効率で採点。旧式はコストを1回引くだけで、コストに比例
        // しない値の大きさそのものを過大評価するバイアスがあった。
        function scoreCard(c) {
          const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5;
          return raw / Math.max(c.cost, 0.5);
        }
        const cards = Array.from(document.querySelectorAll('#rewardCards .card'));
        let best = cards[0], bestScore = -Infinity;
        for (const el of cards) {
          const s = scoreCard(CARD_LIBRARY[el.dataset.cardId]);
          if (s > bestScore) { bestScore = s; best = el; }
        }
        best.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      });
      continue;
    }

    if (snap.mode === 'buff') {
      await page.evaluate(() => {
        const hpRatio = state.player.hp / state.player.maxHp;
        const priority = hpRatio < 0.5
          ? ['renewal', 'vigor', 'might', 'ward', 'cleanse']
          : ['might', 'ward', 'cleanse', 'vigor', 'renewal'];
        const cards = Array.from(document.querySelectorAll('#buffCards .card'));
        if (cards.length === 0) return;
        let best = cards[0], bestRank = Infinity;
        for (const el of cards) {
          const rank = priority.indexOf(el.dataset.buffId);
          if (rank !== -1 && rank < bestRank) { bestRank = rank; best = el; }
        }
        best.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      });
      continue;
    }

    if (snap.mode === 'event') {
      // ランダムイベント(除去 or 複製)。除去は適当に1枚、複製はデッキ内で
      // 最もスコアの高いカードを選ぶのが合理的。カードが無ければスキップ。
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#eventCards .card'));
        if (cards.length === 0) {
          document.getElementById('skipEventBtn').click();
          return;
        }
        const isRemove = document.getElementById('eventTitle').textContent.includes('除去');
        let target = cards[0];
        if (!isRemove) {
          function scoreCard(c) {
            const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5;
            return raw / Math.max(c.cost, 0.5);
          }
          let bestScore = -Infinity;
          for (const el of cards) {
            const s = scoreCard(CARD_LIBRARY[el.dataset.cardId]);
            if (s > bestScore) { bestScore = s; target = el; }
          }
        }
        target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      });
      continue;
    }

    // Battle turn: play greedily (same heuristic as playtest.js), then
    // snapshot block/atk/hp right before ending turn so we can measure the
    // margin once the enemy attack resolves.
    await page.evaluate(() => {
      function scoreCard(c, wantBlock) {
        const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * (wantBlock ? 3 : 1);
        return raw / Math.max(c.cost, 0.5);
      }
      let guard = 0;
      while (guard++ < 20) {
        const b = state.battle;
        if (!b || state.mode !== 'battle') break;
        let idx = b.hand.findIndex((id) => {
          const c = CARD_LIBRARY[id];
          return c.cost <= b.energy && c.damage && c.damage * (c.hits || 1) >= state.enemy.hp;
        });
        if (idx === -1) {
          const incoming = Math.max(0, state.enemy.atk - b.block);
          const wantBlock = incoming > state.player.hp * 0.4;
          let best = -1, bestScore = -Infinity;
          b.hand.forEach((id, i) => {
            const c = CARD_LIBRARY[id];
            if (c.cost > b.energy) return;
            const s = scoreCard(c, wantBlock);
            if (s > bestScore) { bestScore = s; best = i; }
          });
          idx = best;
        }
        if (idx === -1) break;
        playCard(idx);
      }
    });

    const preEnd = await page.evaluate(() => (
      state.battle && state.mode === 'battle' && state.enemy && state.enemy.alive
        ? { block: state.battle.block, atk: state.enemy.atk, hp: state.player.hp, maxHp: state.player.maxHp }
        : null
    ));

    await page.evaluate(() => { if (state.mode === 'battle') endPlayerTurn(); });

    if (preEnd) {
      const after = await page.evaluate(() => (state.player ? { hp: state.player.hp } : null));
      if (after) {
        const dmgTaken = Math.max(0, preEnd.atk - preEnd.block);
        attackEvents.push({
          block: preEnd.block, atk: preEnd.atk, dmgTaken,
          hpBefore: preEnd.hp, hpAfter: after.hp, maxHp: preEnd.maxHp,
        });
      }
    }
  }

  return { difficulty, won: false, floorReached: -1, timedOut: true, attackEvents, rewardEvents };
}

function stdDev(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function analyze(rs, diff) {
  const wins = rs.filter((r) => r.won);
  const losses = rs.filter((r) => !r.won && !r.timedOut);

  // Near-death survivals: fraction of WON runs where HP dropped below 20%
  // of max at some point after an attack and the run still continued/won.
  const nearDeathWins = wins.filter((r) =>
    r.attackEvents.some((e) => e.hpAfter > 0 && e.hpAfter <= NEAR_DEATH_RATIO * e.maxHp)
  );

  // Heartbreak losses: floor reached (vs MAX_FLOOR=100) and enemy HP% left.
  const lossFloors = losses.map((r) => r.floorReached);
  const lossEnemyHpPct = losses
    .filter((r) => r.enemyMaxHpAtDeath)
    .map((r) => Math.max(0, r.enemyHpAtDeath) / r.enemyMaxHpAtDeath * 100);

  // Clutch blocks: turns where |block - atk| <= CLUTCH_MARGIN (barely
  // enough or barely not enough), among all attack events across all runs.
  const allAttacks = rs.flatMap((r) => r.attackEvents);
  const clutchAttacks = allAttacks.filter((e) => e.atk > 0 && Math.abs(e.block - e.atk) <= CLUTCH_MARGIN);

  // Run-to-run variance in floorReached (all runs, win or lose).
  const allFloors = rs.map((r) => Math.max(0, r.floorReached));

  // Reward decision closeness: gap between best and 2nd-best of the 3
  // offered add-cards.
  const allRewards = rs.flatMap((r) => r.rewardEvents);
  const gaps = allRewards
    .filter((rw) => rw.offeredScores.length >= 2)
    .map((rw) => {
      const sorted = [...rw.offeredScores].sort((a, b) => b - a);
      return sorted[0] - sorted[1];
    });
  const closeDecisions = gaps.filter((g) => g <= 2).length;

  // Remove-option plausibility: reward screens where the best offered add
  // is mediocre (score <= 8, i.e. roughly starter-strike tier) AND the
  // deck already has a lot of chaff (>=5 cards scoring <=6) - situations
  // where a human might genuinely consider "remove" competitive with the
  // adds, even though the bot's formula (and the balance-tester's finding
  // that energy, not deck size, is the bottleneck) says it usually isn't.
  const removeTemptingEvents = allRewards.filter((rw) => {
    const bestOffered = Math.max(...rw.offeredScores);
    return bestOffered <= 8 && rw.chaffCount >= 5;
  });

  console.log(`\n=== [${diff}] tension metrics (${rs.length} runs, ${wins.length} won / ${losses.length} lost / ${rs.length - wins.length - losses.length} timed out) ===`);
  console.log(`Near-death survivals: ${nearDeathWins.length}/${wins.length} won runs (${wins.length ? (nearDeathWins.length / wins.length * 100).toFixed(1) : 'N/A'}%) dropped below ${NEAR_DEATH_RATIO * 100}% HP and still won`);
  if (losses.length) {
    console.log(`Heartbreak losses: avg floor reached ${(lossFloors.reduce((a, b) => a + b, 0) / lossFloors.length).toFixed(1)} / ${100 /*MAX_FLOOR*/} ` +
      `(min ${Math.min(...lossFloors)}, max ${Math.max(...lossFloors)}); ` +
      `avg enemy HP% remaining at death: ${lossEnemyHpPct.length ? (lossEnemyHpPct.reduce((a, b) => a + b, 0) / lossEnemyHpPct.length).toFixed(1) + '%' : 'N/A'}`);
  } else {
    console.log('Heartbreak losses: no losses recorded');
  }
  console.log(`Clutch blocks: ${clutchAttacks.length}/${allAttacks.length} attack-turns (${allAttacks.length ? (clutchAttacks.length / allAttacks.length * 100).toFixed(1) : 'N/A'}%) had |block-atk| <= ${CLUTCH_MARGIN}`);
  console.log(`Run-to-run variance: floorReached mean=${(allFloors.reduce((a, b) => a + b, 0) / allFloors.length).toFixed(1)} stdDev=${stdDev(allFloors).toFixed(1)} min=${Math.min(...allFloors)} max=${Math.max(...allFloors)}`);
  console.log(`Reward decision closeness: ${closeDecisions}/${gaps.length} (${gaps.length ? (closeDecisions / gaps.length * 100).toFixed(1) : 'N/A'}%) reward screens had best-vs-2nd-best score gap <= 2; avg gap=${gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : 'N/A'}`);
  console.log(`Remove-tempting reward screens (best add score <=8 AND deck chaffCount>=5): ${removeTemptingEvents.length}/${allRewards.length} (${allRewards.length ? (removeTemptingEvents.length / allRewards.length * 100).toFixed(1) : 'N/A'}%)`);

  return {
    diff, nearDeathWinFrac: wins.length ? nearDeathWins.length / wins.length : null,
    lossFloors, lossEnemyHpPct, clutchFrac: allAttacks.length ? clutchAttacks.length / allAttacks.length : null,
    floorMean: allFloors.reduce((a, b) => a + b, 0) / allFloors.length, floorStd: stdDev(allFloors),
    closeDecisionFrac: gaps.length ? closeDecisions / gaps.length : null,
    removeTemptingFrac: allRewards.length ? removeTemptingEvents.length / allRewards.length : null,
  };
}

async function main() {
  const runsPerDifficulty = parseInt(process.argv[2], 10) || DEFAULT_RUNS;
  const onlyDiff = process.argv[3];
  const diffsToRun = onlyDiff ? [onlyDiff] : ALL_DIFFICULTIES;

  const launchOpts = fs.existsSync(CCR_CHROMIUM) ? { executablePath: CCR_CHROMIUM } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  await page.goto(INDEX_URL);

  const results = [];
  for (const diff of diffsToRun) {
    for (let i = 0; i < runsPerDifficulty; i++) {
      results.push(await playOneRun(page, diff));
    }
  }
  await browser.close();

  const summaries = [];
  for (const diff of diffsToRun) {
    const rs = results.filter((r) => r.difficulty === diff);
    summaries.push(analyze(rs, diff));
  }

  console.log('\nRAW_SUMMARY_JSON:' + JSON.stringify(summaries));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
