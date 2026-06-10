# Plan 276 — Run-4 Cycle 2 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle2/_aggregate.md`
Every finding from the run-4 cycle-2 reviews is either scheduled in
`plan/plan-275-run4-cycle2-fixes.md` or recorded here. Severity/confidence preserved
from the original review (no downgrades). Deferred work remains bound by repo policy
(GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, Node 24 / TS 6
toolchain) when picked up.

## Deferred items

### DEF-R4C2-01 — Tokens UI grants all three scopes with no least-privilege choice
- **Original ID / severity / confidence:** DES-OBS-R4C2-11 — LOW / Low (designer
  observation).
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:52`
  — `scopes: ['lr:upload', 'lr:read', 'lr:delete']` hardcoded on create.
- **Category check:** not security-vulnerability class (scopes are an authorization
  ceiling enforced server-side per route; the only scope-consuming surface today is the
  LR upload route requiring `lr:upload` — `lr:read`/`lr:delete` have no consuming
  endpoints yet, so the broader grant currently authorizes nothing extra). Not
  correctness, not data-loss. Deferral permitted — no repo rule forbids deferring
  product-scoping/UX-choice findings; CLAUDE.md documents admin accounts as
  full-privilege root admins with no capability model.
- **Reason for deferral:** adding scope checkboxes is feature/product work, not a defect
  fix; the run-loop's deferred-fix rules forbid inventing feature work, and the existing
  grant is a no-op privilege today (no `lr:read`/`lr:delete` consumers exist).
- **Exit criterion (re-opens this item):** the first endpoint that consumes `lr:read` or
  `lr:delete` lands (e.g., LR plugin two-way sync or remote delete). At that point the
  create dialog must expose per-scope selection defaulting to `lr:upload` only, with a
  migration note for existing all-scope tokens.

## Non-deferred confirmation
All other findings (COR-R4C2-01, SEC-R4C2-02, UX-R4C2-03, COR-R4C2-04, SEC/COR-R4C2-05,
ARCH-R4C2-06, COR-R4C2-07, COR-R4C2-08, TEST-R4C2-09, TEST-R4C2-10) are scheduled in
plan-275 — nothing silently dropped. Security/correctness findings were NOT deferred.
