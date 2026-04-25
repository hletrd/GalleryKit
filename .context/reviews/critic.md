# Critic — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Critique angle
The Unicode-formatting hardening lineage (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01 → C4L-SEC-01) has been applied piecemeal: one new field per cycle, never the full fanout. Each cycle's plan touches the smallest possible surface. That ratchets up the parity-gap surface area for the next reviewer instead of closing the policy in one motion.

## New findings

### C5L-CRIT-01 — Piecemeal application of Unicode-formatting policy is inviting regression [LOW] [High confidence]

**Surface:** `validation.ts`, `topics.ts`, `images.ts`, `settings.ts`, `seo.ts`.

**Why a problem.** Three cycles in a row have closed exactly one Unicode-formatting gap. Each commit adds one `if (UNICODE_FORMAT_CHARS.test(value)) return false;` line in a different file. The policy is now scattered across `validation.ts` (constant) plus inline tests in two validator helpers, but three other admin-controlled string surfaces still lack the check (`topics.label`, `images.title`, `images.description`). A reviewer who lands a new admin string field next month is unlikely to discover this scattered policy from reading the code.

**Concrete failure scenario.** Cycle 6 closes `topic.label`. Cycle 7 closes `image.title`. Cycle 8 closes `image.description`. Each commit is "fix(security): bidi/invisible chars in X" with no shared helper or compile-time guard.

**Suggested fix.**
1. Promote the per-field test into a shared helper in `validation.ts` so future contributors see one canonical entry point.
2. Apply it in this cycle to `topic.label`, `image.title`, `image.description` together — close the parity gap in one motion rather than three more cycles.
3. Document the policy in `CLAUDE.md` security architecture so the next contributor reads "every admin-controlled string column passes the Unicode-formatting check" and adds it to new fields by default.

## Cross-agent agreement
Overlaps with security-reviewer (C5L-SEC-01 root), code-reviewer (C5L-CR-01 inconsistency), architect (shared helper).
