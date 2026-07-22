# Backlog

Durable, cumulative index of findings that evaluators deliberately left
unfixed (medium-severity / judgment-call items, not urgent enough to fix
the cycle they were found in). Maintained by `game-usability-tester` and
`game-feel-evaluator`, each owning their own section below. `game-idea-
agent` reads this as a primary source when researching what to propose
next. See each agent's `.claude/agents/*.md` for the maintenance rules.

## game-usability-tester

- `touch-target: #endTurnBtn/#skipRewardBtn/#removeCardBtn/#skipBuffBtn under 40px` — all measured at 36px tall (shared `padding: 8px 22px; font-size: 14px` button rule), under the ~40px guideline. Width/spacing are fine, this is a height-only shortfall. Re-verified 2026-07-22 (endTurnBtn measured 116.7x36px at iPhone-16e viewport): still accurate.
- `legibility: .cardDesc at 9.5px` — card description text renders just under the ~10-11px comfort floor; hand container has vertical headroom for a small bump. Re-verified 2026-07-22: still 9.5px, unchanged.
- `legibility: disabled-card contrast ~2.36-2.91:1` — `.card.disabled { opacity: 0.4 }` composited over `#111` drops name/desc text contrast well below WCAG AA's 4.5:1, on already-small text. Consider dimming only the border/background instead of the text, or a smaller opacity drop (~0.6). Re-verified 2026-07-22 (recomputed: name 2.91:1, desc 2.36:1 against the composited card background): still accurate.
- `interaction-consistency: pointerdown vs click` — all card elements (hand/reward/buff/remove-deck, 4 sites) use `pointerdown`; every standalone button (10 listeners: end turn, restart, title, skip reward, remove-card, cancel-remove, skip buff, 3x difficulty select) uses `click`. Buttons fire a beat later (on release) than cards (on touch-start). Re-verified 2026-07-22, still accurate (listener count corrected from a prior "11" to the actual 10 — no functional change, just a prior miscount).
- `decision-visibility: #hand gap 6px` — hand-card gap is 6px, inconsistent with the 12px used on reward/buff/remove-deck card rows; `#hand`'s reserved `min-height: 214px` has headroom to match. Re-verified 2026-07-22: still 6px vs 12px, unchanged.
- `decision-visibility: player HP has no urgency cue` — `#battlePlayerHp` renders in the same cyan regardless of HP%, and there's no bar for the player (only the enemy gets a `.hpBarInner` red bar). A player can't tell "am I in danger" from color/shape alone at a glance. Re-verified 2026-07-22 via side-by-side screenshots at 26/26, 4/26, and 4/26+20 block — all three states are visually identical except for the digits themselves; still accurate.

## game-feel-evaluator

- `beat:boss-telegraph mechanism:none` — `getEnemyIntentText()`'s result is written into `#battleEnemyIntent` via a bare `textContent` update inside `renderBattle()`, same instant/silent treatment as any other stat refresh. No sound, flash, or pacing delay marks the reveal, despite the game investing real design effort in the telegraph itself. Suggested: a short distinct "alert" tone (different timbre from hit beeps) and/or a brief color-pulse on `#battleEnemyIntent`.
- `mechanism:haptics` — `navigator.vibrate` is never used anywhere in the codebase, despite the game being touch-first/mobile-primary. Suggested: `navigator.vibrate(ms)` guarded by a feature check, alongside the existing `flashHit`/`playEndGameSting` call sites (routine hit / lethal hit / win / death).
