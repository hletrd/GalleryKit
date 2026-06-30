# Cycle 39 Docs / Product / Deploy Review

Scope: deployed-workflow docs, photographer-facing policy, and deploy contract at `addf64ac`.

Result: no new scheduled product-policy or deploy-doc drift findings.

Evidence reviewed:
- `AGENTS.md` still requires per-cycle `npm run deploy` from repo root after push.
- `CLAUDE.md` still documents config-driven `.env.deploy` deployment and the service-worker template/build contract.
- No reviewed change requires culling, scoring, editing, checkout, or payment behavior.

Residual risk:
- Deploy validation for this cycle must come from the post-push `npm run deploy` run, not from review-only inspection.
