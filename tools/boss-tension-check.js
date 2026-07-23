#!/usr/bin/env node
'use strict';

/**
 * Boss-telegraph tension check.
 *
 * Focused instrumentation for the new boss "intent" mechanic (attack 60% /
 * charge 20% / guard 20%, telegraphed before the player commits their turn,
 * with charge -> next attack dealing 2x). Reuses the greedy bot from
 * tools/playtest.js and tools/tension-check.js unmodified (it does NOT look
 * at enemy.actionType/chargeBonus at all), so this script also reports
 * whether the bot's own block-seeking behavior changes when a telegraph is
 * showing - i.e. whether the telegraph is even mechanically "seen" by a
 * simple rational player, separate from whether the raw tension numbers on
 * boss floors differ from regular floors.
 *
 * Usage: node tools/boss-tension-check.js [runsPerDifficulty] [difficulty]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_URL = 'file://' + path.join(REPO_ROOT, 'index.html');

const ALL_DIFFICULTIES = ['easy', 'normal', 'hard'];
const DEFAULT_RUNS = 25;
const MAX_TURNS = 600;
const NEAR_DEATH_RATIO = 0.2;
const CLUTCH_MARGIN = 3;

const CCR_CHROMIUM = '/opt/pw-browsers/chromium';

async function playOneRun(page, difficulty) {
  await page.evaluate((diff) => newGame(diff), difficulty);

  const attackEvents = []; // one per resolved enemy-turn (boss or regular)

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const snap = await page.evaluate(() => ({ gameOver: state.gameOver, mode: state.mode }));

    if (snap.gameOver) {
      const final = await page.evaluate(() => ({ won: state.floor >= MAX_FLOOR, floor: state.floor }));
      return { difficulty, won: final.won, floorReached: final.floor, attackEvents };
    }

    if (snap.mode === 'reward') {
      await page.evaluate(() => {
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
          ? ['renewal', 'insight', 'vigor', 'might', 'ward']
          : ['might', 'insight', 'ward', 'vigor', 'renewal'];
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

    // Capture the telegraph BEFORE the bot plays this turn (this is what a
    // human/bot would see and could react to).
    const pre = await page.evaluate(() => (
      state.battle && state.mode === 'battle' && state.enemy && state.enemy.alive
        ? {
            isBoss: state.enemy.isBoss,
            actionType: state.enemy.actionType,
            chargeBonus: state.enemy.chargeBonus,
            floor: state.floor,
          }
        : null
    ));

    // Same unmodified greedy bot as playtest.js / tension-check.js - it does
    // not reference actionType/chargeBonus anywhere.
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

    if (preEnd && pre) {
      const after = await page.evaluate(() => (state.player ? { hp: state.player.hp } : null));
      if (after) {
        // Effective damage this resolved turn (accounts for boss 2x/0dmg,
        // matching what game.js actually applied).
        const dmgTaken = preEnd.hp - after.hp > 0 ? preEnd.hp - after.hp : 0;
        attackEvents.push({
          isBoss: pre.isBoss, actionType: pre.actionType, chargeBonus: pre.chargeBonus, floor: pre.floor,
          block: preEnd.block, baseAtk: preEnd.atk, dmgTaken,
          hpBefore: preEnd.hp, hpAfter: after.hp, maxHp: preEnd.maxHp,
        });
      }
    }
  }

  return { difficulty, won: false, floorReached: -1, timedOut: true, attackEvents };
}

function stdDev(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

function analyze(rs, diff) {
  const allEvents = rs.flatMap((r) => r.attackEvents);
  const bossEvents = allEvents.filter((e) => e.isBoss);
  const regEvents = allEvents.filter((e) => !e.isBoss);

  function metrics(evs, label) {
    const nonZeroDmgTurns = evs.filter((e) => e.dmgTaken > 0 || e.actionType === 'attack');
    const clutch = evs.filter((e) => e.dmgTaken > 0 && Math.abs(e.block - e.dmgTaken) <= CLUTCH_MARGIN);
    const nearDeath = evs.filter((e) => e.hpAfter > 0 && e.hpAfter <= NEAR_DEATH_RATIO * e.maxHp);
    const lethalMisses = evs.filter((e) => e.hpAfter <= 0); // died this turn
    console.log(`  ${label}: n=${evs.length} clutch(|block-dmg|<=${CLUTCH_MARGIN})=${clutch.length} (${evs.length ? (clutch.length/evs.length*100).toFixed(1) : 'N/A'}%) ` +
      `nearDeathAfter=${nearDeath.length} (${evs.length ? (nearDeath.length/evs.length*100).toFixed(1) : 'N/A'}%) deathsThisTurn=${lethalMisses.length}`);
    return { n: evs.length, clutchFrac: evs.length ? clutch.length / evs.length : null, nearDeathFrac: evs.length ? nearDeath.length / evs.length : null };
  }

  console.log(`\n=== [${diff}] boss vs regular floor tension (${rs.length} runs) ===`);
  const bossM = metrics(bossEvents, 'BOSS floors  ');
  const regM = metrics(regEvents, 'REGULAR floors');

  // Charge-telegraph-specific: turns where actionType=='charge' this turn
  // (0 dmg now) - how much "wasted" block did the bot build relative to what
  // a reactive player (racing to kill, or dumping only 1 cheap block card)
  // would need, since 0 damage is coming regardless of block played?
  const chargeTurns = bossEvents.filter((e) => e.actionType === 'charge');
  const avgBlockOnCharge = chargeTurns.length
    ? chargeTurns.reduce((a, e) => a + e.block, 0) / chargeTurns.length : null;

  const guardTurns = bossEvents.filter((e) => e.actionType === 'guard');
  const avgBlockOnGuard = guardTurns.length
    ? guardTurns.reduce((a, e) => a + e.block, 0) / guardTurns.length : null;

  // The payoff turn: actionType=='attack' AND chargeBonus true -> effective
  // 2x incoming. Was the bot's block (built using only base atk, per its
  // unmodified heuristic) enough?
  const payoffTurns = bossEvents.filter((e) => e.actionType === 'attack' && e.chargeBonus);
  const payoffUnderBlocked = payoffTurns.filter((e) => e.block < e.baseAtk * 2);
  const payoffDamageTaken = payoffTurns.filter((e) => e.dmgTaken > 0);
  const avgPayoffDmg = payoffTurns.length ? payoffTurns.reduce((a, e) => a + e.dmgTaken, 0) / payoffTurns.length : null;

  // Normal (non-charge-primed) boss attack turns for comparison.
  const normalAtkTurns = bossEvents.filter((e) => e.actionType === 'attack' && !e.chargeBonus);
  const avgNormalDmg = normalAtkTurns.length ? normalAtkTurns.reduce((a, e) => a + e.dmgTaken, 0) / normalAtkTurns.length : null;

  console.log(`  Charge-telegraphed turns (0 dmg incoming, bot still played toward its 0.4*HP block-want heuristic): n=${chargeTurns.length}, avg block built anyway=${avgBlockOnCharge !== null ? avgBlockOnCharge.toFixed(1) : 'N/A'}`);
  console.log(`  Guard-telegraphed turns (0 dmg incoming): n=${guardTurns.length}, avg block built anyway=${avgBlockOnGuard !== null ? avgBlockOnGuard.toFixed(1) : 'N/A'}`);
  console.log(`  2x-payoff turns (attack after charge primed): n=${payoffTurns.length}, avg dmg taken=${avgPayoffDmg !== null ? avgPayoffDmg.toFixed(1) : 'N/A'}, ` +
    `underblocked(block < 2*baseAtk)=${payoffUnderBlocked.length}/${payoffTurns.length}, tookNonzeroDmg=${payoffDamageTaken.length}/${payoffTurns.length}`);
  console.log(`  Plain boss attack turns (no charge priming) for comparison: n=${normalAtkTurns.length}, avg dmg taken=${avgNormalDmg !== null ? avgNormalDmg.toFixed(1) : 'N/A'}`);
  console.log(`  --> Bot block volume on charge/guard telegraph vs plain-attack telegraph: charge=${avgBlockOnCharge !== null ? avgBlockOnCharge.toFixed(1) : 'N/A'} guard=${avgBlockOnGuard !== null ? avgBlockOnGuard.toFixed(1) : 'N/A'} plainAttack=${normalAtkTurns.length ? (normalAtkTurns.reduce((a,e)=>a+e.block,0)/normalAtkTurns.length).toFixed(1) : 'N/A'} payoff=${payoffTurns.length ? (payoffTurns.reduce((a,e)=>a+e.block,0)/payoffTurns.length).toFixed(1) : 'N/A'} (near-identical => bot heuristic ignores actionType entirely)`);

  // Run-level: how many runs die specifically to/around a boss floor (floor % 10 == 0)?
  const losses = rs.filter((r) => !r.won && !r.timedOut);
  const bossFloorDeaths = losses.filter((r) => r.floorReached % 10 === 0 || r.floorReached % 10 === 9);
  console.log(`  Losses on/just-before a boss floor (floor%10 in {9,0}): ${bossFloorDeaths.length}/${losses.length}`);

  const allFloors = rs.map((r) => Math.max(0, r.floorReached));
  console.log(`  Run floorReached: mean=${(allFloors.reduce((a,b)=>a+b,0)/allFloors.length).toFixed(1)} stdDev=${stdDev(allFloors).toFixed(1)}`);

  return { diff, bossM, regM, chargeTurns: chargeTurns.length, payoffTurns: payoffTurns.length, avgPayoffDmg, avgNormalDmg };
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

main().catch((err) => { console.error(err); process.exit(1); });
