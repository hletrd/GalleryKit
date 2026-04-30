# Agent Roster — Cycle 3 RPF

Registered/available review-style surfaces detected before fan-out:

## Native spawn tool roles available in this environment
- verifier
- debugger
- designer
- researcher (used for document-specialist style review)
- default (used for named reviewer roles not exposed as explicit native tool roles)

## Local review-style agent files detected
- /Users/hletrd/.claude/agents/perf-reviewer.md
- /Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md
- /Users/hletrd/.codex/agents/product-marketer-reviewer.md

## Requested reviewer roles for Prompt 1
- code-reviewer — spawned via default role prompt
- perf-reviewer — spawned via default role prompt
- security-reviewer — spawned via default role prompt
- critic — spawned via default role prompt
- verifier — spawned via native verifier role
- test-engineer — scheduled after concurrency slot frees (native tool limit)
- tracer — scheduled after concurrency slot frees (native tool limit)
- architect — scheduled after concurrency slot frees (native tool limit)
- debugger — scheduled after concurrency slot frees
- document-specialist — scheduled via researcher after concurrency slot frees
- designer / UI-UX designer reviewer — scheduled via native designer after concurrency slot frees
- product-marketer-reviewer — scheduled after concurrency slot frees

Note: the Codex native subagent runtime caps concurrent child agents at six. This cycle used the maximum safe concurrency and queued the remaining review roles after a slot became available rather than silently dropping any detected reviewer role.
