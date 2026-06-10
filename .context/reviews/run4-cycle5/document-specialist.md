# Document-specialist — Run-4 Cycle 5

Angle: doc/code mismatches against authoritative sources (the code, the
gate configs, and live-verified runtime behavior).

## Inventory
- CLAUDE.md sections: Testing, Lint Gates, Common Commands, DB schema
  table, Race Condition Protections, Operational Playbook.
- AGENTS.md quality-gates list.
- Plan ledger: `plan/plan-279` (complete), `plan/plan-280` (deferral
  ledger), standing deferrals plan-274 / 276 / 278.
- In-code doc blocks touched by cycle 4 (serve-upload docstring, download
  route header comment, LR containment comments).
- Review-artifact claims vs live-verified behavior (mysql2 flags).

## Findings (documentation corrections — recorded, with one knowledge-base correction scheduled as a comment fix)

### DOC-R4C5-08 — "no CLIENT_FOUND_ROWS" rationale in webhook comment + cycle-4 aggregate is factually wrong (conclusion still right) — LOW / Confidence: High
- `api/stripe/webhook/route.ts:~350` comment reasons that the SELECT-race
  loser's INSERT IGNORE reports `affectedRows` "without CLIENT_FOUND_ROWS
  — never 1 for the loser", and `run4-cycle4/_aggregate.md` records the
  gate as "PROVEN against the pool config (no CLIENT_FOUND_ROWS flag)".
  **Live verification this cycle disproves the premise:** mysql2's
  DEFAULT flags INCLUDE `FOUND_ROWS` (no-op UPDATE against the running
  `gk-e2e-mysql` returned `affectedRows = 1, changedRows = 0`; the repo
  sets no custom `flags` in `src/db/index.ts`). The webhook gate is still
  CORRECT — INSERT IGNORE reports 0 for a suppressed duplicate under
  either flag setting — but the recorded rationale would mislead a future
  maintainer auditing any UPDATE-based `affectedRows` guard (matched-rows,
  not changed-rows, is the actual semantics in this app).
- Fix: correct the webhook comment's flag claim (keep the conclusion);
  this review file + the code-reviewer file correct the review-artifact
  record (review artifacts are immutable history — corrected forward, not
  rewritten).

### Verified current (no drift)
- CLAUDE.md `Testing` + `Lint Gates` now document the blocking
  `typecheck` gate and say "Four lint scripts" including
  `lint:public-route-rate-limit` (R4C1-08 + R4C4-08 fixes hold on disk).
- AGENTS.md "Quality gates (all blocking)" lists all six fast gates —
  matches the orchestrator's GATES list.
- `serve-upload.ts` SWR docstring now matches behavior (the R4C4-01 fix
  made the "misbehaving DB cannot stall image responses" claim true; the
  only blocking case — cold start — is documented as such).
- Download route header comment (steps 1-6) matches the open-before-claim
  implementation.
- CLAUDE.md schema table: `smart_collections` "Admin-defined dynamic
  galleries (US-P42)" — accurate (DB-managed; no admin UI yet, none
  claimed).
- Backfill runbook, advisory-lock scope note, deploy/disk-hygiene
  playbook: spot-checked against scripts — current.

## Standing-deferral re-audit (for the PROMPT 2 ledger)
- **DEF-R4C1-01** (plan-274, LR route `revalidateAllAppData()` breadth):
  exit = ISR reintroduced on a public route or measured cost. Verified:
  every public page still exports `revalidate = 0` (grep this cycle;
  sitemap's 3600 predates and is out of scope of the criterion as
  recorded). Un-triggered → remains deferred.
- **DEF-R4C2-01** (plan-276, tokens UI grants all three scopes): exit =
  first endpoint consuming `lr:read` / `lr:delete`. Verified: grep finds
  the scopes only in `lib/admin-tokens.ts` type/constant declarations; the
  only consuming route remains `api/admin/lr/upload` (`lr:upload`).
  Un-triggered → remains deferred.
- **DEF-R4C3-01** (plan-278, LR upload ROUTE error strings English): exit
  = LR plugin localization or a browser consumer of the route. Verified:
  no browser consumer (route still PAT-only), no plugin i18n. Un-triggered
  → remains deferred. (The cycle-5 I18N-R4C5-03 items are ACTION-boundary
  strings on browser-reachable surfaces — different class, scheduled for
  fix, consistent with how R4C4-05 was handled.)
