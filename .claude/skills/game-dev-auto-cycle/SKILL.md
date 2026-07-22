---
name: game-dev-auto-cycle
description: Runs one full cycle of the idea -> code -> test -> evaluate -> dopamine -> usability -> feel -> content-health -> audit pipeline fully autonomously, with no approval gate -- game-idea-agent proposes, game-coding-agent implements it immediately, game-qa-debugger checks for bugs, game-balance-tester checks balance, game-dopamine-evaluator checks tension/excitement, game-usability-tester checks ease-of-use and visual design (every cycle, including image-based screenshot review), game-feel-evaluator checks presentation/juice (sound, pacing, motion, haptics at dramatic beats), game-content-health-auditor periodically (self-gated) checks whether the card/buff pool has gone stale and whether balance has silently drifted, game-agent-auditor checks whether the pipeline's own agents are working correctly. Use for the recurring/scheduled game-improvement loop where the user does not want to approve each idea first.
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
8. **Content health**: launch `game-content-health-auditor` every cycle.
   It self-gates internally (checks its own `last-checked` marker in
   `BACKLOG.md` and skips the heavy work if it ran recently, roughly
   every ~3 hours of real activity) — the orchestrator always launches
   it, the agent itself decides whether to do a full check or a one-line
   skip. This is the only stage watching two things nobody else does
   over time: whether the card/buff pool keeps growing (not just being
   polished) across many cycles, and whether balance has silently
   drifted independent of any single cycle's diff.
9. **Audit**: launch `game-agent-auditor` to check whether the agents
   that just ran this cycle actually did their jobs correctly (not
   whether the game is good — that's stages 3-8). It cross-checks
   commits/reports against real repo state and will edit an agent's own
   `.claude/agents/*.md` instructions if it finds a systemic gap.
10. **Report**: a concise summary of the cycle — idea implemented, what
   each stage found/changed (including usability's and feel's
   findings/suggestions), final commit hashes, and anything the auditor
   flagged or fixed about the pipeline itself. This is what the user will
   read later; make it scannable, not a transcript.
11. **Schedule the next cycle**: this loop runs back-to-back as each
    cycle finishes, not on a fixed clock interval, and it runs
    continuously/indefinitely (24/7/365) by explicit user request — there
    is no daily stop time. Use `create_trigger` to make a **one-shot**
    trigger (self-bound to this session, `run_once_at` ~1 minute from
    now — the minimum practical delay) named exactly
    `"Game dev cycle continuation"` whose prompt re-invokes this skill
    (same content as this cycle's own invocation). If a trigger with
    that exact name is already enabled (shouldn't normally happen since
    each one is one-shot and disables itself after firing, but check via
    `list_triggers` if unsure), don't create a duplicate. Always do this
    step — the only reason to skip it is an explicit stop instruction
    from the user given this session (see "Stopping the loop" below), or
    a stage-blocking failure per the paragraph below.

Run stages strictly sequentially — each depends on the previous stage's
code/commit state, never run them in parallel. If any stage hits
something it genuinely cannot safely resolve on its own (not just an
ambiguous detail, but something that risks the game being broken or the
idea being fundamentally unsound), stop there rather than pushing a
broken cycle forward, and say clearly what's blocked and why — and don't
schedule a next cycle in that case either, so the loop doesn't hammer on
the same blocker repeatedly.

## Direct fixes vs. routing to game-coding-agent

Stages 3 (Test), 6 (Usability), and 7 (Feel) can surface concrete,
well-specified problems, not just design suggestions. The orchestrator
running this skill may fix these directly (as its own commit, separate
from the finding stage's own commit) rather than launching a fresh
`game-coding-agent` invocation, when the fix is:
- **Small** — realistically a handful of lines, not a new subsystem.
- **Fully specified by the finding itself** — the finding already names
  the exact file/lines and what's wrong; applying it doesn't require
  inventing new design (e.g. "this CSS selector is missing an id" or
  "this timeout isn't tracked per-element" is fully specified; "this
  card feels underpowered" is not).
- **Not a change to a gameplay-numeric table** — even a one-line,
  fully-specified-looking change to `CARD_LIBRARY`/`MONSTER_TYPES`/
  `REWARD_POOL`/`BUFF_POOL`/`DIFFICULTIES` values is a balance judgment
  call, not a mechanical fix, regardless of line count. Always route
  those to `game-coding-agent` (or let `game-balance-tester` handle it
  per its own tuning rules if that's the stage that found it).
- **Verified before committing** — if the finding came with its own
  repro steps, actually reproduce them (e.g. a small Playwright probe)
  and confirm the fix resolves them, not just a syntax check. Fall back
  to a syntax/sanity check only when the finding has no reproducible
  repro to begin with.

If a finding doesn't meet all four, route it to `game-coding-agent` as a
fresh implementation task instead of fixing it inline.

**Stage 5 (Dopamine) findings are eligible too, but need a stricter test
than the four criteria above**: dopamine findings are often about
audio/timing/UX *quality* rather than mechanical correctness, so only
direct-fix when the chosen value is a strict function of an existing
coded constant that fully resolves the described problem (e.g. a delay
set to *at least* an already-coded decay/duration constant, not a
partial or "largely enough" fraction of it). If the finding or the
fix's own justification uses hedge words like "largely," "mostly," or
"should feel," that's a tuning call, not a mechanical fix — route it to
`game-coding-agent` instead. (Precedent: commit 1110008 set a 220ms
delay against a coded 350ms decay constant, justified as "largely
decayed" — under this rule that would have failed the strict-function
test and should have routed out; it wasn't reverted since it works and
was independently verified, but future stage-5 findings should be held
to this line, not to what that commit did.)

## Stopping the loop

This loop is intended to run continuously, 24/7/365, by explicit user
request — there is no scheduled stop. It only ever stops if the user
explicitly says so in a live turn. If that happens: because each cycle
schedules its own successor (step 10) instead of running on a fixed
cron, stopping the loop means canceling whatever
`"Game dev cycle continuation"` trigger is currently pending, not
deleting a recurring cron trigger. Call `list_triggers`, find the
enabled one named `"Game dev cycle continuation"` (there should be at
most one at a time), and `delete_trigger` it. If none is found, a cycle
is likely mid-flight — tell the user it'll schedule one more successor
when it finishes, and that one will need to be canceled too (or just
tell them to say "stop" again once the in-flight cycle's report lands).

This skill produces no approval checkpoint by design — do not pause to
ask the user mid-cycle. That's the whole point of this skill versus
`/propose-game-idea` + `/implement-approved-idea` (which do gate on
approval, for when the user wants that back).
