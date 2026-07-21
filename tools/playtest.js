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

async function playOneRun(page, difficulty) {
  await page.evaluate((diff) => newGame(diff), difficulty);

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
      return { difficulty, won: final.won, floorReached: final.floor, turns: turn };
    }

    if (snap.mode === 'reward') {
      await page.evaluate(() => {
        // Pick the best-value of the 3 offered cards (same scoring idea as
        // in-battle play) rather than always the first, so the bot's deck
        // growth is a closer proxy for a decent player's choices.
        const cards = Array.from(document.querySelectorAll('#rewardCards .card'));
        if (cards.length === 0) return;
        let best = cards[0], bestScore = -Infinity;
        for (const el of cards) {
          const c = CARD_LIBRARY[el.dataset.cardId];
          const score = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5 - c.cost;
          if (score > bestScore) { bestScore = score; best = el; }
        }
        best.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      });
      continue;
    }

    // Battle turn: greedily play cards, then end turn.
    await page.evaluate(() => {
      function scoreCard(c, wantBlock) {
        return (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * (wantBlock ? 3 : 1) - c.cost * 0.5;
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

  return { difficulty, won: false, floorReached: -1, turns: MAX_TURNS, timedOut: true };
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
  }

  console.log('RAW_JSON:' + JSON.stringify(results));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
