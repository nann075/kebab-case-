#!/usr/bin/env node
'use strict';

/**
 * Headless balance playtester.
 *
 * Drives the real game (index.html + game.js) through Playwright, calling the
 * exact same functions the UI buttons call (playCard, endPlayerTurn, reward
 * card clicks, newGame). A simple greedy bot picks cards each turn so we can
 * simulate many runs quickly and measure win rate / death floor per
 * difficulty for balance tuning.
 *
 * Usage:
 *   node tools/playtest.js [runsPerDifficulty] [difficulty]
 *
 * Examples:
 *   node tools/playtest.js            # 30 runs each of easy/normal/hard
 *   node tools/playtest.js 100 easy   # 100 runs of easy only
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_URL = 'file://' + path.join(REPO_ROOT, 'index.html');

const ALL_DIFFICULTIES = ['easy', 'normal', 'hard'];
const DEFAULT_RUNS = 30;
const MAX_TURNS = 500;

const CCR_CHROMIUM = '/opt/pw-browsers/chromium';

// BUFF_FORCE env var (optional): forces the bot to always take the named
// buff whenever it appears among the 3 offered, for isolated A/B measurement
// of one BUFF_LIBRARY entry's real run-level impact (win rate / floor
// reached) rather than relying on the fixed heuristic priority below. Falls
// back to the normal heuristic when the forced buff isn't offered.
const FORCE_BUFF = process.env.BUFF_FORCE || null;

async function playOneRun(page, difficulty) {
  await page.evaluate((diff) => newGame(diff), difficulty);
  const rewardOffers = [];
  const buffOffers = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const snap = await page.evaluate(() => ({
      gameOver: state.gameOver,
      mode: state.mode,
    }));

    if (snap.gameOver) {
      const final = await page.evaluate(() => ({
        won: state.floor >= MAX_FLOOR,
        floor: state.floor,
      }));
      return { difficulty, won: final.won, floorReached: final.floor, turns: turn, rewardOffers, buffOffers };
    }

    if (snap.mode === 'reward') {
      const pick = await page.evaluate(() => {
        // Pick the best-value of the 3 offered cards (same scoring idea as
        // in-battle play) rather than always the first, so the bot's deck
        // growth is a closer proxy for a decent player's choices.
        const cards = Array.from(document.querySelectorAll('#rewardCards .card'));
        if (cards.length === 0) return null;
        let best = cards[0], bestScore = -Infinity;
        for (const el of cards) {
          const c = CARD_LIBRARY[el.dataset.cardId];
          // コスト効率(コスト当たりの価値)で採点する。旧式はコストを1回
          // 引くだけだったため、コストに比例しない値の大きさそのものを
          // 過大評価するバイアスがあった(例: バッシュ12dmg/コスト2が、
          // 同じ1エネルギーあたり効率のストライク6dmg/コスト1より2倍近く
          // 高スコアになっていた)。コスト0のカードは無償の価値として
          // 常に最優先する。
          const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5;
          const score = raw / Math.max(c.cost, 0.5);
          if (score > bestScore) { bestScore = score; best = el; }
        }
        const offered = cards.map((el) => el.dataset.cardId);
        const chosen = best.dataset.cardId;
        best.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
        return { offered, chosen };
      });
      if (pick) rewardOffers.push(pick);
      continue;
    }

    if (snap.mode === 'buff') {
      const pick = await page.evaluate((forceBuff) => {
        // Heal if badly hurt, otherwise favor permanent power-ups (might/ward)
        // over one-off maxHP/deck-thin picks.
        const hpRatio = state.player.hp / state.player.maxHp;
        let priority = hpRatio < 0.5
          ? ['renewal', 'insight', 'vigor', 'might', 'ward']
          : ['might', 'insight', 'ward', 'vigor', 'renewal'];
        if (forceBuff) priority = [forceBuff, ...priority.filter((id) => id !== forceBuff)];
        const cards = Array.from(document.querySelectorAll('#buffCards .card'));
        if (cards.length === 0) return null;
        let best = cards[0], bestRank = Infinity;
        for (const el of cards) {
          const rank = priority.indexOf(el.dataset.buffId);
          if (rank !== -1 && rank < bestRank) { bestRank = rank; best = el; }
        }
        const offered = cards.map((el) => el.dataset.buffId);
        const chosen = best.dataset.buffId;
        best.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
        return { offered, chosen };
      }, FORCE_BUFF);
      if (pick) buffOffers.push(pick);
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

    // Battle turn: greedily play cards, then end turn.
    await page.evaluate(() => {
      function scoreCard(c, wantBlock) {
        // コスト効率で採点(reward-pick側と同じ修正、詳細はそちらのコメント参照)。
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
      if (state.mode === 'battle') endPlayerTurn();
    });
  }

  return { difficulty, won: false, floorReached: -1, turns: MAX_TURNS, timedOut: true, rewardOffers, buffOffers };
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

  for (const diff of diffsToRun) {
    const rs = results.filter((r) => r.difficulty === diff);
    const wins = rs.filter((r) => r.won).length;
    const deaths = rs.filter((r) => !r.won && !r.timedOut);
    const avgDeathFloor = deaths.length
      ? (deaths.reduce((s, r) => s + r.floorReached, 0) / deaths.length).toFixed(1)
      : 'N/A';
    const avgFloorAll = (rs.reduce((s, r) => s + Math.max(0, r.floorReached), 0) / rs.length).toFixed(1);
    const timeouts = rs.filter((r) => r.timedOut).length;

    console.log(
      `[${diff}] runs=${rs.length} winRate=${((wins / rs.length) * 100).toFixed(1)}% ` +
      `avgFloorReached=${avgFloorAll} avgDeathFloor=${avgDeathFloor}` +
      (timeouts ? ` (warning: ${timeouts} run(s) hit the turn cap)` : '')
    );

    const offered = {};
    const chosen = {};
    for (const r of rs) {
      for (const o of (r.rewardOffers || [])) {
        for (const id of o.offered) offered[id] = (offered[id] || 0) + 1;
        chosen[o.chosen] = (chosen[o.chosen] || 0) + 1;
      }
    }
    const cardIds = Object.keys(offered).sort();
    const pickRates = cardIds
      .map((id) => `${id}:${((chosen[id] || 0) / offered[id] * 100).toFixed(0)}%(${chosen[id] || 0}/${offered[id]})`)
      .join(' ');
    console.log(`[${diff}] reward pick-rate: ${pickRates}`);

    const buffOffered = {};
    const buffChosen = {};
    for (const r of rs) {
      for (const o of (r.buffOffers || [])) {
        for (const id of o.offered) buffOffered[id] = (buffOffered[id] || 0) + 1;
        buffChosen[o.chosen] = (buffChosen[o.chosen] || 0) + 1;
      }
    }
    const buffIds = Object.keys(buffOffered).sort();
    const buffPickRates = buffIds
      .map((id) => `${id}:${((buffChosen[id] || 0) / buffOffered[id] * 100).toFixed(0)}%(${buffChosen[id] || 0}/${buffOffered[id]})`)
      .join(' ');
    console.log(`[${diff}] buff pick-rate: ${buffPickRates}`);
  }

  console.log('RAW_JSON:' + JSON.stringify(results));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
