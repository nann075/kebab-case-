#!/usr/bin/env node
'use strict';

/**
 * Guard-telegraph decision-point check.
 *
 * Focused follow-up to tools/boss-tension-check.js, asking one specific
 * question about the newly-tuned boss "guard" stance (30% roll, attack
 * cards deal only 0.35x damage that turn, telegraphed via
 * getEnemyIntentText before the player commits their turn):
 *
 *   Does reacting to the guard telegraph actually matter? I.e. does a bot
 *   that reads state.enemy.actionType and reacts (skips blocking on
 *   guard turns, since guard means the boss deals exactly 0 damage that
 *   turn no matter what) produce meaningfully different outcomes/margins
 *   than a bot that is fully blind to actionType (plays the same greedy
 *   heuristic every turn, same as tools/playtest.js and
 *   tools/tension-check.js)?
 *
 * Also breaks down clutch/near-death/damage-taken purely by boss
 * actionType (attack, charge, guard, and 2x-payoff-attack) across the
 * blind bot's boss-floor turns, so guard's contribution to tension can be
 * directly compared against charge's.
 *
 * Usage: node tools/guard-decision-check.js [runsPerVariant] [difficulty]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_URL = 'file://' + path.join(REPO_ROOT, 'index.html');

const DEFAULT_RUNS = 40;
const DEFAULT_DIFF = 'normal';
const MAX_TURNS = 600;
const NEAR_DEATH_RATIO = 0.2;
const CLUTCH_MARGIN = 3;

const CCR_CHROMIUM = '/opt/pw-browsers/chromium';

// `aware`: identical greedy heuristic, EXCEPT it knows guard means 0
// incoming damage this turn (so it never spends energy on block cards
// while guard is telegraphed - block cannot possibly matter) and it uses
// the *displayed* (chargeBonus-adjusted) incoming damage rather than raw
// enemy.atk when deciding whether to block. This is the best a fully
// rational player could do reacting to the intent text alone.
async function playOneRun(page, difficulty, aware) {
  await page.evaluate((diff) => newGame(diff), difficulty);

  const attackEvents = [];

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

    const pre = await page.evaluate(() => (
      state.battle && state.mode === 'battle' && state.enemy && state.enemy.alive
        ? { isBoss: state.enemy.isBoss, actionType: state.enemy.actionType, chargeBonus: state.enemy.chargeBonus, floor: state.floor }
        : null
    ));

    await page.evaluate((isAware) => {
      function scoreCard(c, wantBlock, guardActive) {
        // Aware bot values damage cards normally even under guard (still
        // the best use of otherwise-wasted energy - nothing carries over
        // between turns), it just never chases block under guard.
        const raw = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * (wantBlock ? 3 : (guardActive ? 0 : 1));
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
          const isBoss = state.enemy.isBoss;
          const guardActive = isAware && isBoss && state.enemy.actionType === 'guard';
          // Aware bot uses the SAME telegraphed number the player sees in
          // getEnemyIntentText (chargeBonus-doubled atk on payoff turns;
          // exactly 0 on guard turns), instead of blind enemy.atk.
          let telegraphedAtk;
          if (!isBoss) telegraphedAtk = state.enemy.atk;
          else if (state.enemy.actionType === 'guard') telegraphedAtk = 0;
          else if (state.enemy.actionType === 'charge') telegraphedAtk = 0;
          else telegraphedAtk = state.enemy.chargeBonus ? state.enemy.atk * 2 : state.enemy.atk;
          const atkForHeuristic = isAware ? telegraphedAtk : state.enemy.atk;
          const incoming = Math.max(0, atkForHeuristic - b.block);
          const wantBlock = incoming > state.player.hp * 0.4;
          let best = -1, bestScore = -Infinity;
          b.hand.forEach((id, i) => {
            const c = CARD_LIBRARY[id];
            if (c.cost > b.energy) return;
            const s = scoreCard(c, wantBlock, guardActive);
            if (s > bestScore) { bestScore = s; best = i; }
          });
          idx = best;
        }
        if (idx === -1) break;
        playCard(idx);
      }
    }, aware);

    const preEnd = await page.evaluate(() => (
      state.battle && state.mode === 'battle' && state.enemy && state.enemy.alive
        ? { block: state.battle.block, atk: state.enemy.atk, hp: state.player.hp, maxHp: state.player.maxHp }
        : null
    ));

    await page.evaluate(() => { if (state.mode === 'battle') endPlayerTurn(); });

    if (preEnd && pre) {
      const after = await page.evaluate(() => (state.player ? { hp: state.player.hp } : null));
      if (after) {
        const dmgTaken = preEnd.hp - after.hp > 0 ? preEnd.hp - after.hp : 0;
        attackEvents.push({
          isBoss: pre.isBoss, actionType: pre.actionType, chargeBonus: pre.chargeBonus, floor: pre.floor,
          block: preEnd.block, baseAtk: preEnd.atk, dmgTaken, hpBefore: preEnd.hp, hpAfter: after.hp, maxHp: preEnd.maxHp,
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

function breakdownByType(rs, label) {
  const evs = rs.flatMap((r) => r.attackEvents).filter((e) => e.isBoss);
  const groups = {
    'plain attack (no charge)': evs.filter((e) => e.actionType === 'attack' && !e.chargeBonus),
    '2x payoff attack (charge->attack)': evs.filter((e) => e.actionType === 'attack' && e.chargeBonus),
    'charge (telegraph turn, 0 dmg)': evs.filter((e) => e.actionType === 'charge'),
    'guard (telegraph turn, 0 dmg + 0.35x player dmg)': evs.filter((e) => e.actionType === 'guard'),
  };
  console.log(`\n--- ${label}: boss-turn breakdown by actionType ---`);
  for (const [name, g] of Object.entries(groups)) {
    if (g.length === 0) { console.log(`  ${name}: n=0`); continue; }
    const clutch = g.filter((e) => e.dmgTaken > 0 && Math.abs(e.block - e.dmgTaken) <= CLUTCH_MARGIN);
    const nearDeath = g.filter((e) => e.hpAfter > 0 && e.hpAfter <= NEAR_DEATH_RATIO * e.maxHp);
    const deaths = g.filter((e) => e.hpAfter <= 0);
    const avgDmg = g.reduce((a, e) => a + e.dmgTaken, 0) / g.length;
    const avgBlockWasted = g.reduce((a, e) => a + e.block, 0) / g.length;
    console.log(`  ${name}: n=${g.length} avgDmgTaken=${avgDmg.toFixed(1)} clutch=${clutch.length} (${(clutch.length/g.length*100).toFixed(1)}%) nearDeathAfter=${nearDeath.length} (${(nearDeath.length/g.length*100).toFixed(1)}%) deaths=${deaths.length} avgBlockBuiltOnThisTurn=${avgBlockWasted.toFixed(1)}`);
  }
  return groups;
}

async function main() {
  const runsPerVariant = parseInt(process.argv[2], 10) || DEFAULT_RUNS;
  const difficulty = process.argv[3] || DEFAULT_DIFF;

  const launchOpts = fs.existsSync(CCR_CHROMIUM) ? { executablePath: CCR_CHROMIUM } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  await page.goto(INDEX_URL);

  const blindRuns = [];
  const awareRuns = [];
  for (let i = 0; i < runsPerVariant; i++) blindRuns.push(await playOneRun(page, difficulty, false));
  for (let i = 0; i < runsPerVariant; i++) awareRuns.push(await playOneRun(page, difficulty, true));
  await browser.close();

  console.log(`\n=== Guard-telegraph decision-point check [${difficulty}], ${runsPerVariant} runs/variant ===`);

  breakdownByType(blindRuns, 'BLIND bot (ignores actionType, same heuristic as playtest.js)');
  breakdownByType(awareRuns, 'AWARE bot (reacts to telegraph: skips block under guard, uses true 2x-adjusted incoming)');

  function summarize(rs, label) {
    const floors = rs.map((r) => Math.max(0, r.floorReached));
    const wins = rs.filter((r) => r.won).length;
    const guardEvs = rs.flatMap((r) => r.attackEvents).filter((e) => e.isBoss && e.actionType === 'guard');
    const avgGuardBlock = guardEvs.length ? guardEvs.reduce((a, e) => a + e.block, 0) / guardEvs.length : null;
    const payoffEvs = rs.flatMap((r) => r.attackEvents).filter((e) => e.isBoss && e.actionType === 'attack' && e.chargeBonus);
    const avgPayoffDmg = payoffEvs.length ? payoffEvs.reduce((a, e) => a + e.dmgTaken, 0) / payoffEvs.length : null;
    const payoffDeaths = payoffEvs.filter((e) => e.hpAfter <= 0).length;
    console.log(`\n${label}: wins=${wins}/${rs.length} floorReached mean=${(floors.reduce((a,b)=>a+b,0)/floors.length).toFixed(1)} stdDev=${stdDev(floors).toFixed(1)}`);
    console.log(`  avg block wastefully built on guard turns: ${avgGuardBlock !== null ? avgGuardBlock.toFixed(2) : 'N/A'}`);
    console.log(`  avg dmg taken on 2x-payoff turns: ${avgPayoffDmg !== null ? avgPayoffDmg.toFixed(1) : 'N/A'}, deaths on payoff turns: ${payoffDeaths}`);
  }
  summarize(blindRuns, 'BLIND');
  summarize(awareRuns, 'AWARE');
}

main().catch((err) => { console.error(err); process.exit(1); });
