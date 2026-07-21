---
name: implement-approved-idea
description: Runs the full code -> test -> evaluate pipeline for an idea the user has already approved (from /propose-game-idea or described directly) -- game-coding-agent implements it, game-qa-debugger checks for bugs, game-balance-tester checks balance/reachability impact. Use once the user has said yes to a specific proposed idea for this game.
argument-hint: "[the approved idea, if not already clear from context]"
---

Run the remaining three stages of the idea -> code -> test -> evaluate
pipeline for an idea the user has just approved (from the most recent
`/propose-game-idea` proposal in this conversation, or from
`$ARGUMENTS` / the user's message if they described it directly).

1. **Code**: launch `game-coding-agent` with the exact approved idea
   description (don't paraphrase away specifics — pass cost/value
   numbers, card names, etc. if the proposal had them). Wait for it to
   finish and report the commit.
2. **Test**: launch `game-qa-debugger` to run its standard checklist
   against the new state of the repo, focused especially on whatever the
   new feature touches (new screens/overlays, new interaction paths).
   If it finds and fixes bugs, that's a separate commit from step 1 —
   fine, that's expected.
3. **Evaluate**: launch `game-balance-tester` to check the new feature's
   impact — at minimum a fresh playtest baseline, and specifically
   whether the new content changed win rate / reachability / reward
   pick-rates in the intended direction without breaking the existing
   difficulty curve. If it finds a real problem (e.g. the new card
   dominates every reward screen, or win rate collapsed/exploded), it
   should tune and re-verify per its own instructions.
4. **Report**: summarize the full cycle for the user — what was
   implemented, what QA found (if anything), what the balance impact
   was (before/after numbers if the evaluator ran them), and commit
   hashes. Keep it scannable, not a transcript of each subagent's full
   output.

Run stages sequentially (each depends on the previous one's code state),
not in parallel. If any stage reports something ambiguous or risky that
it deliberately left unfixed, surface that to the user rather than
silently proceeding.
