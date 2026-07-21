---
name: propose-game-idea
description: Runs the game-idea-agent to propose one concrete improvement idea for the card-battle roguelike, then presents it to the user and stops to await approval. First stage of the idea -> code -> test -> evaluate pipeline. Use when it's time to generate a new idea for this game (on request, or as the recurring step of a scheduled dev-pipeline loop).
---

1. Check whether there is already a pending, not-yet-approved idea
   proposal earlier in this conversation that the user hasn't responded
   to yet. If so, do NOT generate a new one — a stale unanswered proposal
   piling up on top of another is worse than silence. Just note briefly
   that a proposal is still awaiting a decision, and stop.
2. Otherwise, launch the `game-idea-agent` subagent (foreground — you
   need its output before you can present it, this isn't background
   work) to produce exactly one proposal, per its own instructions.
3. Present the proposal to the user exactly as returned (idea / why /
   how / risk / open question), in Japanese if the conversation has been
   in Japanese. Ask clearly whether they'd like it implemented.
4. Stop here. Do NOT call `game-coding-agent` or otherwise start
   implementing in this same turn — implementation only happens after
   the user explicitly approves, via `/implement-approved-idea` or by
   just continuing the conversation with a yes.
