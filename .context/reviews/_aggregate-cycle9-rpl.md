# Aggregate review — cycle 9 rpl

Generated: 2026-04-23. HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

Per-agent source files (cycle 9 rpl):
- `.context/reviews/code-reviewer-cycle9-rpl.md`
- `.context/reviews/security-reviewer-cycle9-rpl.md`
- `.context/reviews/perf-reviewer-cycle9-rpl.md`
- `.context/reviews/critic-cycle9-rpl.md`
- `.context/reviews/verifier-cycle9-rpl.md`
- `.context/reviews/test-engineer-cycle9-rpl.md`
- `.context/reviews/tracer-cycle9-rpl.md`
- `.context/reviews/architect-cycle9-rpl.md`
- `.context/reviews/debugger-cycle9-rpl.md`
- `.context/reviews/document-specialist-cycle9-rpl.md`
- `.context/reviews/designer-cycle9-rpl.md`

## Gate status snapshot

- eslint: PASS (`npm run lint --workspace=apps/web`)
- lint:api-auth: PASS
- lint:action-origin: PASS
- vitest: PASS (48 files, 281 tests)
- next build + tsc: PASS
- playwright e2e: PASS (19 tests)

## Consolidated findings (deduplicated)

### AGG9R-RPL-01 — `updatePassword` validation errors pre-incremented rate-limit counter [MEDIUM / HIGH]
- `apps/web/src/app/actions/auth.ts:297-326`.
- Signal: code-reviewer (C9R-RPL-01), security-reviewer (C9R-RPL-S01), tracer (full trace + H2 diagnosis), test-engineer (T01), verifier (V03), architect (A-1), critic. **7 agents** concur.
- Finding: pre-increment of password_change rate-limit counter happens BEFORE the four validation early-returns (empty field / mismatch / too-short / too-long). Admin typos burn the 10-attempt budget without triggering any Argon2 verify. Admin gets locked out of password change for 15 minutes purely from client-side typos.
- Fix (agreed across agents): Move the three form-field extractions + four validations above the rate-limit pre-increment block, matching the `login` ordering at auth.ts:83-89.
- Test: add assertion in `auth-rate-limit.test.ts` that validation-error returns do not mutate the rate-limit counter.

### AGG9R-RPL-02 — `createAdminUser` rate-limit ordering has the same class of issue (smaller impact) [LOW / HIGH]
- `apps/web/src/app/actions/admin-users.ts:83-125`.
- Signal: tracer (companion trace to AGG9R-RPL-01).
- Finding: rate-limit increment happens BEFORE username/password form-field extraction. Similar pattern inconsistency, but the action is only reachable by already-authenticated admins, so self-DoS scope is narrower.
- Fix: reorder in the same manner. Separate commit from AGG9R-RPL-01 since the impact differs.

### AGG9R-RPL-03 — CSV-injection doc drift in CLAUDE.md [INVALID — false positive]
- CLAUDE.md "Database Security" section, line 146.
- Originally signaled by verifier (V01), document-specialist (D-1).
- Re-reading the actual CLAUDE.md line: it correctly says "escapes formula
  injection characters (`=`, `+`, `-`, `@`) with leading-whitespace tolerance
  (C7R-RPL-01), strips C0/C1 control characters, strips Unicode bidi override
  and isolate chars ... strips zero-width / invisible formatting chars". This
  is accurate against `csv-escape.ts`. The reviewers were quoting paraphrased
  text that does not exist in the file.
- Status: NO ACTION REQUIRED. Withdrawn.

### AGG9R-RPL-04 — CLAUDE.md doesn't document account-scoped login rate limit [LOW / MEDIUM]
- `auth.ts:118-130`, CLAUDE.md Authentication & Sessions section.
- Signal: verifier (V02), document-specialist (D-2).
- Fix: add bullet to CLAUDE.md about the `acct:<hash>` bucket with SHA-256 username digest.

### AGG9R-RPL-05 — CLAUDE.md doesn't document `gallerykit:image-processing:<id>` advisory lock [LOW / MEDIUM]
- `image-queue.ts:123-153`, CLAUDE.md Race Condition Protections section.
- Signal: document-specialist (D-3).
- Fix: add the lock name to the list that already contains `gallerykit_db_restore`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`.

### AGG9R-RPL-06 — `PhotoViewer` renders dead branches for `original_format` / `original_file_size` on public routes [LOW / HIGH]
- `apps/web/src/components/photo-viewer.tsx:463-475`.
- Signal: code-reviewer (C9R-RPL-04), designer (D01).
- Finding: These two fields are omitted from `publicSelectFields` (privacy omission), so the render blocks are permanently dead on `/p/[id]`, `/s/[key]`, `/g/[key]`.
- Two options:
  (a) make the fields public (they are low-signal metadata, not PII) and actually display them on public routes;
  (b) remove the dead branches from the public viewer.
- Defer: needs product-level decision on whether public viewers should see format/file-size.

### AGG9R-RPL-07 — Search dialog lacks `aria-live` announcement for result count [LOW / MEDIUM]
- `apps/web/src/components/search.tsx:207-251`.
- Signal: designer (D02).
- Fix: add off-screen `aria-live="polite"` region announcing "N results found" / "no results" / "error".

### AGG9R-RPL-08 — Search dialog silently swallows fetch errors [LOW / MEDIUM]
- `apps/web/src/components/search.tsx:56-59`.
- Signal: designer (D05).
- Fix: differentiate error state from empty state; announce via aria-live.

### AGG9R-RPL-09 — `pruneShareRateLimit` has no cadence throttle [LOW / MEDIUM]
- `apps/web/src/app/actions/sharing.ts:36-67`.
- Signal: code-reviewer (C9R-RPL-02), perf-reviewer (P01), critic (ordering-policy critique).
- Fix: add 1-second cadence matching `pruneSearchRateLimit`.

### AGG9R-RPL-10 — `searchImages` internal length check is dead code [LOW / LOW]
- `apps/web/src/lib/data.ts:727`.
- Signal: code-reviewer (C9R-RPL-03).
- Fix: comment or drop. Observational.

### AGG9R-RPL-11 — `flushGroupViewCounts` partial-failure counter semantics [LOW / MEDIUM]
- `apps/web/src/lib/data.ts:82-89`.
- Signal: code-reviewer (C9R-RPL-05).
- Fix: bump consecutiveFlushFailures on any re-buffered entry, not only total-failure.

### AGG9R-RPL-12 — `deleteTopicAlias` dead-regex `\x00` branch [LOW / LOW]
- `apps/web/src/app/actions/topics.ts:446`.
- Signal: security-reviewer (C9R-RPL-S03).
- Fix: remove `\x00` from the regex since stripControlChars already removed it.

### AGG9R-RPL-13 — `restoreDatabase` RELEASE_LOCK has no query timeout [LOW / MEDIUM]
- `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.
- Signal: debugger (D-5).
- Fix: wrap the release query in a timeout or use mysql2's per-query timeout to avoid pool starvation.

### AGG9R-RPL-14 — `recordFailedLoginAttempt` is dead export [LOW / LOW]
- `apps/web/src/lib/auth-rate-limit.ts:20-27`.
- Signal: debugger (D-6).
- Fix: remove or mark internal.

### AGG9R-RPL-15 — Lint-gate scanner family duplicates TypeScript AST walking logic [LOW / MEDIUM]
- `apps/web/scripts/check-action-origin.ts` + `check-api-auth.ts`.
- Signal: architect (A-3).
- Fix: extract shared `scripts/lib/ts-ast.ts` helper. Future-facing; defer.

### AGG9R-RPL-16 — `revalidateAllAppData` overuse [LOW / MEDIUM]
- Multiple call sites in `tags.ts`, `topics.ts`.
- Signal: architect (A-4).
- Fix: audit per-call-site; replace with narrow `revalidateLocalizedPaths` where appropriate. Benchmark-gated; defer.

### AGG9R-RPL-17 — Single-process restore-maintenance state [LOW / MEDIUM]
- `apps/web/src/lib/restore-maintenance.ts`, global Symbol.
- Signal: architect (A-5).
- Fix: document the single-process assumption explicitly in CLAUDE.md. No code fix.

### AGG9R-RPL-18 — Privacy field-selection indirection could be extracted to its own module [LOW / LOW]
- `data.ts:111-200`.
- Signal: architect (A-2).
- Defer: refactor-only; no correctness impact.

### AGG9R-RPL-19 — `getImages` has been dead code for multiple cycles [LOW / LOW]
- `data.ts:398`.
- Signal: code-reviewer (carryforward of AGG5R-07).
- Status: confirmed still dead code. Plan-149 already defers this.

## Cross-agent agreement signals

- 7 agents flag AGG9R-RPL-01 (the critical updatePassword ordering bug).
- 3 agents flag AGG9R-RPL-03 (CSV doc drift).
- 3 agents flag AGG9R-RPL-09 (share rate-limit pruning cadence).
- 2 agents flag AGG9R-RPL-04 (account-scoped login rate limit documentation).
- 2 agents flag AGG9R-RPL-05 (image-processing advisory lock documentation).
- 2 agents flag AGG9R-RPL-06 (PhotoViewer dead UI branches).

## Agent failures

None.

## Summary totals

- 0 HIGH findings
- 1 MEDIUM finding (AGG9R-RPL-01, should fix this cycle)
- 18 LOW findings
- Should-fix this cycle: AGG9R-RPL-01 (code) — fixed in commit `0000000d7bef338f0aaef7386005ce02b932332e`
- Withdrawn (false positive): AGG9R-RPL-03
- Defer: remainder

## Implementation status

- AGG9R-RPL-01: FIXED in commit `0000000d7bef338f0aaef7386005ce02b932332e`
  (`fix(auth): 🛡️ validate updatePassword form fields before rate-limit increment`).
  Includes regression test `auth-rate-limit-ordering.test.ts`. All gates green
  after commit.
- AGG9R-RPL-03: WITHDRAWN (CLAUDE.md line 146 was already accurate; reviewers
  were quoting paraphrased text that does not exist in the file).
