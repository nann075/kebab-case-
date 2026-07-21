---
name: debug-game
description: QA the card-battle roguelike's screens and behavior for bugs, visual glitches, or unnatural interactions using Playwright. Use when the user wants the game debugged, checked for bugs, or reviewed for anything broken/odd.
argument-hint: "[optional: area to focus on, e.g. 'mobile layout' or 'reward screen']"
---

Launch the `game-qa-debugger` subagent to inspect this repo's game
(`index.html` + `game.js`) for bugs and visual/behavioral issues.

1. If `$ARGUMENTS` names a specific area (e.g. "mobile layout", "card
   double-tap", "game over screen"), tell the subagent to focus there
   first, then still run its standard checklist for broad coverage.
2. Otherwise run the subagent's full standard checklist (all screens at
   desktop + mobile widths, all listed behavioral probes).
3. Relay the subagent's findings to the user as-is, organized by severity.
   Do not fabricate or soften findings — if it reports a real bug, say so
   plainly with the repro steps it found.
4. If the user then asks you to fix a specific finding, make the fix
   yourself in `game.js`/`index.html`, verify with a quick Playwright
   check or `node -c`, and report back before/after.

This is a QA pass, not a balance pass — for card/difficulty balance use
`/playtest-balance` and the `game-balance-tester` subagent instead.
