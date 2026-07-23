#!/usr/bin/env node
'use strict';

/**
 * Retribution-strike ("報復の一撃") risk-decision check.
 *
 * The card (cost2/star3, 10 dmg normally, 20 dmg while a boss's
 * chargeBonus is banked) is pitched as a genuine risk/reward dilemma:
 * "play defense during a boss's telegraphed charge, or gamble on offense
 * for double damage." This script asks whether that's actually true, by
 * checking WHEN the doubled-damage window can be captured relative to
 * whether the player is actually in danger that same turn:
 *
 *   - state.enemy.chargeBonus is set true the moment a boss's 'charge'
 *     action resolves, and is only cleared again when a subsequent
 *     'attack' action resolves (game.js enemyBattleAttack). Between those
 *     two events the boss can re-roll 'charge' or 'guard' again, and
 *     chargeBonus stays banked with ZERO incoming damage to the player
 *     that turn (charge deals 0 dmg; guard deals 0 dmg but also nerfs the
 *     player's own damage 65%, applied AFTER the 2x, per game.js:
 *     `baseDamage*=2` then `dmg = round(dmg*0.35)` if actionType==='guard').
 *   - So there are two structurally different ways to land the 2x:
 *       "payoffRisk"  - actionType==='attack' && chargeBonus: the boss's
 *                        big hit lands THIS SAME turn resolution, right
 *                        after the player commits to spending cost on
 *                        retribution_strike instead of blocking. Real risk.
 *       "chargeChain" - actionType==='charge' && chargeBonus (a repeat
 *                        charge after an earlier one already banked the
 *                        bonus): 0 incoming damage this turn, no output
 *                        penalty. A free double-damage window if you
 *                        happen to hold the card.
 *       "guardChain"  - actionType==='guard' && chargeBonus: 0 incoming
 *                        damage, but the 65% guard penalty applies AFTER
 *                        the doubling, so net output is actually WORSE
 *                        than a normal unboosted hit - not a free lunch.
 *
 * Because the game discards the whole hand at end of turn (no hand
 * carryover, see game.js endPlayerTurn), a bot can't literally "stockpile"
 * the card for the ideal window - it can only act on whichever window is
 * present on the turn(s) the card happens to be drawn into hand. So the
 * question this script answers is: given the card is in hand on a boss
 * floor, does an informed ("aware") bot's usage skew toward the free
 * chargeChain window disproportionately relative to how often that window
 * even occurs, and is there a measurable tension/danger difference between
 * turns where the bonus was captured via payoffRisk vs chargeChain? If the
 * card is captured deolinstrongly and near-death signal is concentrated
 * on payoffRisk turns while chargeChain turns are consistently safe, that
 * validates real risk. If chargeChain captures a large share of bonus
 * plays with no accompanying danger, the "risk" framing is mostly cosmetic.
 *
 * The card is force-added to the starting deck (one copy) so its usage
 * frequency isn't at the mercy of the star3 reward-draft RNG - this
 * isolates "how does the card get used once available" from "how often is
 * it drafted at all" (a separate, already-covered balance question).
 *
 * Usage: node tools/retribution-decision-check.js [runsPerVariant] [difficulty]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const lib = require('./lib/bot-lib');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_URL = 'file://' + path.join(REPO_ROOT, 'index.html');

const DEFAULT_RUNS = 40;
const DEFAULT_DIFF = 'normal';
const MAX_TURNS = 600;
const NEAR_DEATH_RATIO = 0.2;
const CARD_ID = 'retribution_strike';

function classifyWindow(enemy) {
  if (!enemy || !enemy.isBoss) return 'nonBoss';
  if (enemy.actionType === 'attack' && enemy.chargeBonus) return 'payoffRisk';
  if (enemy.actionType === 'charge' && enemy.chargeBonus) return 'chargeChain';
  if (enemy.actionType === 'guard' && enemy.chargeBonus) return 'guardChain';
  if (enemy.actionType === 'attack') return 'plainAttack';
  if (enemy.actionType === 'charge') return 'chargeFirst'; // charge telegraphed, bonus not yet banked
  return 'guardNoBonus';
}

// variant: 'blind' (existing shared cost-efficiency heuristic, unaware of
// the card's conditional bonus - scores it by its static damage:10 field
// like any other card) or 'aware' (recognizes chargeBonus and scores the
// card by its EFFECTIVE damage this turn: doubled when chargeBonus is
// banked, further *0.35'd under guard - i.e. the best an informed player
// tracking the actual rule, not just the printed number, could do).
async function playOneRun(page, difficulty, variant) {
  await page.evaluate((diff) => {
    newGame(diff);
    if (!state.player.deck.includes('retribution_strike')) {
      state.player.deck.push('retribution_strike');
    }
  }, difficulty);

  const retributionPlays = [];
  const attackEvents = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const snap = await page.evaluate(() => ({ gameOver: state.gameOver, mode: state.mode }));

    if (snap.gameOver) {
      const final = await page.evaluate(() => ({ won: state.floor >= MAX_FLOOR, floor: state.floor }));
      return { difficulty, variant, won: final.won, floorReached: final.floor, retributionPlays, attackEvents };
    }

    if (snap.mode !== 'battle') {
      await lib.handleNonBattleScreen(page, snap.mode);
      continue;
    }

    const pre = await page.evaluate(() => (
      state.battle && state.enemy && state.enemy.alive
        ? { isBoss: state.enemy.isBoss, actionType: state.enemy.actionType, chargeBonus: state.enemy.chargeBonus, floor: state.floor, hp: state.player.hp, maxHp: state.player.maxHp, enemyHp: state.enemy.hp }
        : null
    ));
    const window = pre ? classifyWindow(pre) : null;

    // Card-play loop. 'blind' reuses the unmodified shared heuristic
    // verbatim. 'aware' is the same heuristic, except retribution_strike's
    // score is computed from its true effective damage this turn instead
    // of the static card.damage field.
    const playedRetribution = await page.evaluate((isAware) => {
      function effectiveRetributionDamage() {
        let d = 10;
        if (state.enemy.isBoss && state.enemy.chargeBonus) d *= 2;
        if (state.enemy.isBoss && state.enemy.actionType === 'guard') d = Math.round(d * 0.35);
        return d;
      }
      function scoreCard(c, wantBlock) {
        let dmg = c.damage || 0;
        if (isAware && c.id === 'retribution_strike') dmg = effectiveRetributionDamage();
        const raw = dmg * (c.hits || 1) * 2 + (c.block || 0) * (wantBlock ? 3 : 1);
        return raw / Math.max(c.cost, 0.5);
      }
      let played = false;
      let guard = 0;
      while (guard++ < 20) {
        const b = state.battle;
        if (!b || state.mode !== 'battle') break;
        let idx = b.hand.findIndex((id) => {
          const c = CARD_LIBRARY[id];
          let dmg = c.damage || 0;
          if (isAware && id === 'retribution_strike') dmg = effectiveRetributionDamage();
          return c.cost <= b.energy && c.damage && dmg * (c.hits || 1) >= state.enemy.hp;
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
        if (b.hand[idx] === 'retribution_strike') played = true;
        playCard(idx);
      }
      return played;
    }, variant === 'aware');

    const preEnd = await page.evaluate(() => (
      state.battle && state.mode === 'battle' && state.enemy && state.enemy.alive
        ? { block: state.battle.block, atk: state.enemy.atk, hp: state.player.hp, maxHp: state.player.maxHp, enemyHp: state.enemy.hp }
        : null
    ));

    await page.evaluate(() => { if (state.mode === 'battle') endPlayerTurn(); });

    const after = await page.evaluate(() => (state.player ? { hp: state.player.hp } : null));

    if (preEnd && pre && after) {
      const dmgTaken = preEnd.hp - after.hp > 0 ? preEnd.hp - after.hp : 0;
      attackEvents.push({ isBoss: pre.isBoss, hpAfter: after.hp, maxHp: preEnd.maxHp, dmgTaken });
      if (playedRetribution) {
        retributionPlays.push({
          variant, window, floor: pre.floor,
          enemyHpBefore: pre.enemyHp, enemyHpAfterPlayerTurn: preEnd.enemyHp,
          playerHpBeforeTurn: pre.hp, playerHpAfterEnemyResolves: after.hp, maxHp: preEnd.maxHp,
          dmgTakenThisTurn: dmgTaken,
        });
      }
    }
  }

  return { difficulty, variant, won: false, floorReached: -1, timedOut: true, retributionPlays, attackEvents };
}

function pct(n, d) { return d ? `${(n / d * 100).toFixed(1)}%` : 'N/A'; }

function analyzeVariant(rs, label) {
  const plays = rs.flatMap((r) => r.retributionPlays);
  console.log(`\n--- ${label}: retribution_strike play windows (n=${plays.length} plays across ${rs.length} runs) ---`);
  const byWindow = {};
  for (const p of plays) {
    byWindow[p.window] = byWindow[p.window] || [];
    byWindow[p.window].push(p);
  }
  for (const [w, ps] of Object.entries(byWindow)) {
    const bonusActive = w === 'payoffRisk' || w === 'chargeChain' || w === 'guardChain';
    const avgDmgTaken = lib.mean(ps.map((p) => p.dmgTakenThisTurn));
    const nearDeath = ps.filter((p) => p.playerHpAfterEnemyResolves > 0 && p.playerHpAfterEnemyResolves <= NEAR_DEATH_RATIO * p.maxHp).length;
    const deaths = ps.filter((p) => p.playerHpAfterEnemyResolves <= 0).length;
    console.log(`  ${w}${bonusActive ? ' [2x DAMAGE ACTIVE]' : ''}: n=${ps.length} (${pct(ps.length, plays.length)} of plays) avgDmgTakenThisTurn=${avgDmgTaken !== null ? avgDmgTaken.toFixed(1) : 'N/A'} nearDeathAfter=${nearDeath} (${pct(nearDeath, ps.length)}) deaths=${deaths}`);
  }
  const bonusPlays = plays.filter((p) => p.window === 'payoffRisk' || p.window === 'chargeChain' || p.window === 'guardChain');
  const freeBonusPlays = plays.filter((p) => p.window === 'chargeChain'); // truly zero-risk, zero-penalty capture
  const riskyBonusPlays = plays.filter((p) => p.window === 'payoffRisk');
  console.log(`  Of ${bonusPlays.length} bonus-active plays: ${pct(freeBonusPlays.length, bonusPlays.length)} were the risk-free chargeChain window, ${pct(riskyBonusPlays.length, bonusPlays.length)} were the genuinely-risky payoffRisk window.`);

  const wins = rs.filter((r) => r.won).length;
  const floors = rs.map((r) => Math.max(0, r.floorReached));
  console.log(`  Run outcomes: wins=${wins}/${rs.length} floorReached mean=${lib.mean(floors).toFixed(1)} stdDev=${lib.stdDev(floors).toFixed(1)}`);

  return { label, plays: plays.length, bonusPlays: bonusPlays.length, freeBonusPlays: freeBonusPlays.length, riskyBonusPlays: riskyBonusPlays.length, wins, runs: rs.length, floors };
}

async function main() {
  const runsPerVariant = parseInt(process.argv[2], 10) || DEFAULT_RUNS;
  const difficulty = process.argv[3] || DEFAULT_DIFF;

  const browser = await chromium.launch(lib.launchOptsFor(fs));
  const page = await browser.newPage();
  await page.goto(INDEX_URL);

  console.log(`=== retribution_strike decision-point check [${difficulty}], ${runsPerVariant} runs/variant ===`);

  const blindRuns = [];
  const awareRuns = [];
  for (let i = 0; i < runsPerVariant; i++) blindRuns.push(await playOneRun(page, difficulty, 'blind'));
  for (let i = 0; i < runsPerVariant; i++) awareRuns.push(await playOneRun(page, difficulty, 'aware'));
  await browser.close();

  const blindSummary = analyzeVariant(blindRuns, 'BLIND bot (scores retribution_strike by its static printed damage:10, same as any other card)');
  const awareSummary = analyzeVariant(awareRuns, 'AWARE bot (scores retribution_strike by its true effective damage this turn, incl. 2x/0.35x)');

  console.log('\nRAW_SUMMARY_JSON:' + JSON.stringify({ blindSummary, awareSummary }));
}

main().catch((err) => { console.error(err); process.exit(1); });
