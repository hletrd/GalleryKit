# Cycle 1 review agent roster

Available Codex spawn roles used: code-reviewer, security-reviewer, critic, verifier, test-engineer, architect, debugger, designer.
Additional reviewer-style agents detected and covered through default-role specialist prompts because they are not native spawn roles here: perf-reviewer (`~/.claude/agents/perf-reviewer.md`), tracer, document-specialist, product-marketer-reviewer (`~/.codex/agents/product-marketer-reviewer.md`), ui-ux-designer-reviewer (`~/.codex/agents/ui-ux-designer-reviewer.md`, covered with designer lane).

Note: Workspace child-agent protocol caps concurrent children at 6, so the fan-out is executed in two waves while preserving prompt order and per-agent provenance.
