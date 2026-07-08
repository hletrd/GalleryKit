# Cycle 26 Aggregate Review

Date: 2026-07-08 KST
Cycle: Run-10 Cycle 26/100
Start HEAD: `101ebef57ae2a379cce4b5fa04dccd538c438b0c`

## Review Lanes

- `code-security-reviewer.md` - no confirmed current code/security finding; auth/origin/rate-limit gates, audit, and targeted security tests passed.
- `perf-ops-reviewer.md` - one current performance/ops issue, already documented as the shared background DB budget carry-forward.
- `test-verifier-reviewer.md` - three regression-coverage gaps, no confirmed live behavior defect.
- `architect-debugger-reviewer.md` - two confirmed restore-maintenance state/order bugs.
- `designer-reviewer.md` - three low-severity UI/accessibility/copy issues.
- `document-product-reviewer.md` - no new documentation/product-claim mismatch.

## Deduped Findings

### AGG-C26-01 - Durable restore-maintenance clear failure reopens the live process while the marker remains

Severity: High
Confidence: High
Cross-agent agreement: architect/debugger primary.

Citation: `apps/web/src/lib/restore-maintenance-durable.ts:121-126`; `apps/web/src/app/[locale]/admin/db-actions.ts:674-695`; `apps/web/src/__tests__/restore-maintenance.test.ts:104-110`.

Problem: `endDurableRestoreMaintenance()` clears the process-local restore flag in a `finally`, even when durable marker removal throws. The restore finalizer logs the clear failure and then resumes normal post-restore work, creating a split-brain state where the live process accepts writes while sidecars and future restarts still see durable maintenance active.

Failure scenario: marker unlink fails after restore, the current web process resumes uploads/background work, but the durable marker remains on disk. The next restart re-enters maintenance, and operator recovery may clear a "stale" marker without realizing writes occurred after the failed clear.

Suggested fix: fail closed when durable marker clear fails. Only clear process-local maintenance after durable marker removal succeeds, and make restore finalization keep maintenance active and return a structured failure if marker removal fails.

### AGG-C26-02 - Protected admin layouts query session/auth state before restore-maintenance check

Severity: Medium
Confidence: High
Cross-agent agreement: architect/debugger primary.

Citation: `apps/web/src/app/[locale]/admin/layout.tsx:14-18`; `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:15-23`; `apps/web/src/app/actions/auth.ts:40-64`; `apps/web/src/lib/session.ts:94-150`; `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx:48-72`.

Problem: admin layouts resolve the current user or admin status before checking restore maintenance. During DB restore, session tables are not authoritative, so the protected admin shell can query or mutate session rows before it renders the maintenance shell.

Failure scenario: an admin visits a protected admin route while restore import/migration is in progress. The request can redirect, throw, or attempt session cleanup against unstable tables instead of showing the non-querying maintenance shell.

Suggested fix: check `isRestoreMaintenanceActive()` before admin auth/session lookup in the parent and protected admin layouts. Update tests to assert `isAdmin()` is not called when maintenance is active.

### AGG-C26-03 - Lightbox color pip disclosure is not programmatically tied to its expanded panel

Severity: Low
Confidence: High
Cross-agent agreement: designer primary.

Citation: `apps/web/src/components/lightbox-color-pip.tsx:166-198`.

Problem: the pip button has `aria-expanded`, but no `aria-controls`; the expanded panel has no stable `id`, region role, or accessible name.

Failure scenario: a screen-reader user hears that the pip expanded but has no programmatic relationship to the revealed color metadata panel.

Suggested fix: add a stable panel id, `aria-controls`, and a named region for the expanded panel.

### AGG-C26-04 - Empty shared albums report a processing state instead of an empty state

Severity: Low
Confidence: High
Cross-agent agreement: designer primary.

Citation: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`; `apps/web/messages/en.json:450`; `apps/web/messages/ko.json:450`.

Problem: a valid shared group with zero images renders `sharedGroup.processing`, even though localized `sharedGroup.empty` copy already exists.

Failure scenario: a recipient opens an intentionally emptied share and waits for "processing" instead of understanding the share has no photos.

Suggested fix: render `t('empty')` for `group.images.length === 0`.

### AGG-C26-05 - Accessible map fallback list drops localized topic labels

Severity: Low
Confidence: Medium
Cross-agent agreement: designer primary.

Citation: `apps/web/src/lib/data.ts:1784-1789`; `apps/web/src/app/[locale]/(public)/map/page.tsx:55-66`, `98-107`.

Problem: `getMapImages()` returns `topic_label`, but map markers keep only the raw `topic` slug. The accessible fallback list renders the slug instead of the localized/admin-maintained label.

Failure scenario: keyboard or screen-reader users skipping the map hear raw slugs such as `family_trip_2026` instead of the configured topic label.

Suggested fix: carry `topic_label` into markers and render `topic_label ?? topic` in the fallback list.

### AGG-C26-06 - Queue and color backfill still budget DB pool capacity independently

Severity: Medium-High
Confidence: High
Cross-agent agreement: perf/ops primary; matches Cycle 25 carry-forward.

Citation: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`, `447-456`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `716-727`; `CLAUDE.md` pool-budget note.

Disposition: deferred as broad architecture/performance work. This is current but not newly actionable within Cycle 26; Cycle 25 already preserves the same issue as `AGG-C25-04` with explicit exit criteria.

### AGG-C26-07 - Sidecar color backfill fail-closed behavior lacks behavior-level regression coverage

Severity: Medium
Confidence: High
Cross-agent agreement: test/verifier primary.

Citation: `apps/web/scripts/backfill-color-pipeline.ts:350-368`; `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:55-67`.

Disposition: deferred as a sidecar test-harness extraction task. Current source behavior is fixed; the remaining gap is regression strength.

### AGG-C26-08 - Restore spawn cleanup remains source-shape tested rather than temp-file leak tested

Severity: Low-Medium
Confidence: High
Cross-agent agreement: test/verifier primary.

Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:893-981`; `apps/web/src/__tests__/db-restore.test.ts:47-84`.

Disposition: deferred. Current implementation appears fixed; behavior harness extraction is test-strength work and is lower priority than the confirmed restore-maintenance state bugs scheduled this cycle.

### AGG-C26-09 - Cycle 25 UI accessibility fixes are mostly string-pinned

Severity: Low-Medium
Confidence: Medium-High
Cross-agent agreement: test/verifier primary.

Citation: `apps/web/src/__tests__/client-source-contracts.test.ts:71-94`; `apps/web/src/components/search.tsx:380-397`; admin category/tag/SEO form components.

Disposition: deferred. No current UI behavior regression was confirmed; interaction-level admin/semantic-search browser coverage can ride a future UI test-hardening cycle.

## Agent Failures

The requested sixth native reviewer-style lane could not be spawned because the agent thread limit was reached. Its documentation/product-claims scope was covered locally and written to `document-product-reviewer.md`.
