# Cycle 3 Review Agent Roster

Detected UI/UX surface: yes — `apps/web/src/app`, `apps/web/src/components`, Tailwind config/assets, Next.js app.

Registered spawn-agent roles selected for fan-out:
- code-reviewer
- security-reviewer
- critic
- verifier
- test-engineer
- architect
- debugger
- designer
- dependency-expert (additional dependency/security-maintenance review lane)
- writer (document/code mismatch lane; `document-specialist` role is not registered in this environment)

Requested roles not registered in the available spawn-agent catalog and therefore skipped as direct roles:
- perf-reviewer / performance-reviewer
- tracer
- document-specialist

No repo-local `.codex/agents`, `.claude/agents`, `.agents`, or `prompts/*reviewer*` agents were detected by the initial local agent-config scan.
