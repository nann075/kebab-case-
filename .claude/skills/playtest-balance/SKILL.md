---
name: playtest-balance
description: Simulate many automated playthroughs of the card-battle roguelike to measure win rate and death floor per difficulty, then get concrete game.js balance tuning suggestions. Use when the user wants the game's difficulty/balance tested, checked, or tuned.
argument-hint: "[runsPerDifficulty] [easy|normal|hard]"
---

Run a game-balance evaluation of the roguelike in this repo using the
`game-balance-tester` subagent.

1. Parse `$ARGUMENTS` for an optional run count (default 30) and an optional
   single difficulty (default: all three — easy, normal, hard).
2. Launch the `game-balance-tester` subagent with those parameters. It will
   run `tools/playtest.js` (a Playwright harness that drives the real game
   through its actual functions with a greedy bot), then report win rate,
   average death floor per difficulty, and specific numeric tuning
   suggestions for `game.js` (DIFFICULTIES / MONSTER_TYPES / CARD_LIBRARY /
   STARTER_DECK).
3. Present the subagent's findings to the user in a compact summary.
4. If the user then asks to apply a suggested change, make the edit to
   `game.js` yourself, re-run `tools/playtest.js` for the affected
   difficulty to confirm the numbers moved as intended, and report the
   before/after comparison.

Do not fabricate playtest numbers — every win rate / death floor figure
reported to the user must come from an actual `tools/playtest.js` run in
this session, not a prior conversation or assumption.
