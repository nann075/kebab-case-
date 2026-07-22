---
name: game-dev-auto-cycle
description: Runs one full cycle of the idea -> code -> test -> evaluate -> dopamine -> audit pipeline fully autonomously, with no approval gate -- game-idea-agent proposes, game-coding-agent implements it immediately, game-qa-debugger checks for bugs, game-balance-tester checks balance, game-dopamine-evaluator checks tension/excitement, game-agent-auditor checks whether the pipeline's own agents are working correctly. Use for the recurring/scheduled game-improvement loop where the user does not want to approve each idea first.
---

Run one complete, unattended cycle of the game-improvement pipeline for
the card-battle roguelike in this repo. The user has explicitly said they
do not need to approve each idea first — implement autonomously, the same
way the overnight balance/QA loop worked.

1. **Idea**: launch `game-idea-agent` (foreground) to produce exactly one
   proposal, per its own instructions (reads current game.js/index.html,
   checks git log so it doesn't repeat/re-litigate already-tried ideas).
2. **Code**: launch `game-coding-agent` with that exact proposal
   (pass its full idea/how/numbers through, don't paraphrase away
   specifics). If the idea agent flagged an "open question" needing a
   human decision, don't block on it — make the more conservative /
   lower-risk choice yourself, note the choice you made, and proceed.
3. **Test**: launch `game-qa-debugger` for its standard checklist against
   the new code, focused on whatever the new feature touches. Fix what
   it safely can; note what it can't.
4. **Evaluate**: launch `game-balance-tester` for a fresh baseline and a
   check on whether the new content moved win rate/reachability/reward
   pick-rates sensibly. Let it tune and re-verify per its own rules if it
   finds a real problem.
5. **Dopamine**: launch `game-dopamine-evaluator` to check tension/
   excitement impact (near-death saves, heartbreak losses, clutch
   blocks, run variance, decision closeness) — separate from raw
   balance.
6. **Audit**: launch `game-agent-auditor` to check whether the agents
   that just ran this cycle actually did their jobs correctly (not
   whether the game is good — that's stages 3-5). It cross-checks
   commits/reports against real repo state and will edit an agent's own
   `.claude/agents/*.md` instructions if it finds a systemic gap.
7. **Report**: a concise summary of the cycle — idea implemented, what
   each stage found/changed, final commit hashes, and anything the
   auditor flagged or fixed about the pipeline itself. This is what the
   user will read later; make it scannable, not a transcript.

Run stages strictly sequentially — each depends on the previous stage's
code/commit state, never run them in parallel. If any stage hits
something it genuinely cannot safely resolve on its own (not just an
ambiguous detail, but something that risks the game being broken or the
idea being fundamentally unsound), stop there rather than pushing a
broken cycle forward, and say clearly what's blocked and why.

This skill produces no approval checkpoint by design — do not pause to
ask the user mid-cycle. That's the whole point of this skill versus
`/propose-game-idea` + `/implement-approved-idea` (which do gate on
approval, for when the user wants that back).
