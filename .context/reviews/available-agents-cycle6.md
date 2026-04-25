# Available review agents — cycle 6

Registered native roles exposed in this environment: analyst, architect, build-fixer, code-reviewer, code-simplifier, critic, debugger, dependency-expert, designer, executor, explore, git-master, planner, researcher, security-reviewer, team-executor, test-engineer, verifier, vision, writer, default, explorer, worker.

Review agents run for Prompt 1: code-reviewer, security-reviewer, critic, verifier, test-engineer, architect, debugger, designer.

Requested but not registered as native agent types in this environment: perf-reviewer, tracer, document-specialist. No repo-local `.codex/agents`, `.claude/agents`, or `prompts/*-reviewer*` files were present.

Note: the first fan-out was capped by the environment's max active agent limit, so architect/debugger/designer ran in a second wave after the first returned. No registered requested review agent was dropped.
