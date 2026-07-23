'use strict';

/**
 * Shared bot-loop / scoring helpers for the Playwright-driven instruments in
 * tools/*.js (playtest.js, tension-check.js, boss-tension-check.js,
 * guard-decision-check.js, retribution-decision-check.js, ...).
 *
 * These were independently copy-pasted into four scripts before this module
 * existed. New scripts should require() this instead of pasting a fifth
 * copy. (The existing four are left as-is for now since they already work
 * and touching them isn't needed for the task that motivated this file -
 * but they are good candidates to migrate to this module next time one of
 * them needs a real edit.)
 *
 * Every function here operates against the real running game in the page
 * (via page.evaluate), calling the game's own functions (playCard,
 * endPlayerTurn, etc.) - never reimplementing game rules on the Node side.
 */

/** Cost-efficiency heuristic used by the reward/buff/event/battle bots. */
function scoreCardSource() {
  return function scoreCard(c, wantBlock) {
    const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * (wantBlock ? 3 : 1);
    return raw / Math.max(c.cost, 0.5);
  };
}

/** Picks the highest cost-efficiency card on a reward screen (3 add options). */
async function handleRewardScreen(page) {
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
}

/** Picks a buff by priority, biased toward survival buffs when HP is low. */
async function handleBuffScreen(page) {
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
}

/** Handles the random remove/duplicate event screen. */
async function handleEventScreen(page) {
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
}

/**
 * Blind greedy battle-turn bot, identical to the one duplicated across
 * playtest.js/tension-check.js/boss-tension-check.js: rush a lethal hit if
 * one is in hand, otherwise weigh block vs damage by whether incoming (raw
 * enemy.atk, no telegraph awareness) damage looks dangerous.
 */
async function playBlindBattleTurn(page) {
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
}

/** Dispatches to the right screen handler based on state.mode; no-op for 'battle'. */
async function handleNonBattleScreen(page, mode) {
  if (mode === 'reward') return handleRewardScreen(page);
  if (mode === 'buff') return handleBuffScreen(page);
  if (mode === 'event') return handleEventScreen(page);
  return false;
}

function stdDev(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

const CCR_CHROMIUM = '/opt/pw-browsers/chromium';

function launchOptsFor(fs) {
  return fs.existsSync(CCR_CHROMIUM) ? { executablePath: CCR_CHROMIUM } : {};
}

module.exports = {
  scoreCardSource,
  handleRewardScreen,
  handleBuffScreen,
  handleEventScreen,
  handleNonBattleScreen,
  playBlindBattleTurn,
  stdDev,
  mean,
  CCR_CHROMIUM,
  launchOptsFor,
};
