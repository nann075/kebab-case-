---
name: game-dev-auto-cycle
description: Runs one full cycle of the idea -> code -> test -> evaluate -> dopamine -> usability -> feel -> audit pipeline fully autonomously, with no approval gate -- game-idea-agent proposes, game-coding-agent implements it immediately, game-qa-debugger checks for bugs, game-balance-tester checks balance, game-dopamine-evaluator checks tension/excitement, game-usability-tester checks ease-of-use and visual design (every cycle, including image-based screenshot review), game-feel-evaluator checks presentation/juice (sound, pacing, motion, haptics at dramatic beats), game-agent-auditor checks whether the pipeline's own agents are working correctly. Use for the recurring/scheduled game-improvement loop where the user does not want to approve each idea first.
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
6. **Usability**: launch `game-usability-tester` every cycle (not
   conditional) to check touch-target size/spacing, legibility, whether
   decision-relevant info stays visible without scrolling, tap-count for
   common actions, and a genuine visual/image-based review of real
   screenshots (hierarchy, clutter, color/theme consistency, at-a-glance
   state legibility) — even for ideas that aren't UI-focused, since a
   backend/numeric change can still shift what's on screen (e.g. new
   card text, new log lines, a new overlay). It should actively surface
   concrete opportunities to improve the UI, not just flag things that
   are broken.
7. **Feel**: launch `game-feel-evaluator` every cycle to check whether
   the game's dramatic beats (big hits, near-lethal moments, boss
   telegraph reveals, floor clear, game over) get any sensory
   reinforcement — sound, deliberate pacing/delay, motion/screen shake,
   haptic feedback — or resolve as silent instant text/number updates.
   This is separate from `game-dopamine-evaluator` (mechanical risk) and
   `game-usability-tester` (comfort/legibility): a mechanically tense,
   perfectly usable moment can still feel flat with zero presentation
   behind it.
8. **Audit**: launch `game-agent-auditor` to check whether the agents
   that just ran this cycle actually did their jobs correctly (not
   whether the game is good — that's stages 3-7). It cross-checks
   commits/reports against real repo state and will edit an agent's own
   `.claude/agents/*.md` instructions if it finds a systemic gap.
9. **Report**: a concise summary of the cycle — idea implemented, what
   each stage found/changed (including usability's and feel's
   findings/suggestions), final commit hashes, and anything the auditor
   flagged or fixed about the pipeline itself. This is what the user will
   read later; make it scannable, not a transcript.
10. **Schedule the next cycle**: this loop runs back-to-back as each
    cycle finishes, not on a fixed clock interval — the user explicitly
    wants it to fire again as soon as there's nothing left to do, not
    wait out an hourly cron. Use `create_trigger` to make a **one-shot**
    trigger (self-bound to this session, `run_once_at` ~1 minute from
    now — the minimum practical delay) named exactly
    `"Game dev cycle continuation"` whose prompt re-invokes this skill
    (same content as this cycle's own invocation). If a trigger with
    that exact name is already enabled (shouldn't normally happen since
    each one is one-shot and disables itself after firing, but check via
    `list_triggers` if unsure), don't create a duplicate. Skip this step
    entirely if it's already past the daily stop time (see below) or a
    stop instruction has otherwise been given this session.

Run stages strictly sequentially — each depends on the previous stage's
code/commit state, never run them in parallel. If any stage hits
something it genuinely cannot safely resolve on its own (not just an
ambiguous detail, but something that risks the game being broken or the
idea being fundamentally unsound), stop there rather than pushing a
broken cycle forward, and say clearly what's blocked and why — and don't
schedule a next cycle in that case either, so the loop doesn't hammer on
the same blocker repeatedly.

## Stopping the loop

Because each cycle schedules its own successor (step 10) instead of
running on a fixed cron, stopping the loop means canceling whatever
`"Game dev cycle continuation"` trigger is currently pending, not
deleting a recurring cron trigger. Call `list_triggers`, find the
enabled one named `"Game dev cycle continuation"` (there should be at
most one at a time), and `delete_trigger` it. If none is found, either a
cycle is mid-flight (it'll schedule its own successor when it finishes —
delete that one instead) or the loop was already stopped.

This skill produces no approval checkpoint by design — do not pause to
ask the user mid-cycle. That's the whole point of this skill versus
`/propose-game-idea` + `/implement-approved-idea` (which do gate on
approval, for when the user wants that back).
