# Run-10 Cycle 10b (loop-B) Deferred Findings — 2026-07-08

Aggregate: `.context/reviews/cycle-10b-2026-07-08/_aggregate.md` (8 merged findings; every
finding is either scheduled in `cycle-10b-2026-07-08-plan.md`, deferred here, or recorded as
already-fixed (peer) — none dropped).

Rules honored (per CLAUDE.md, AGENTS.md, `.context/plans/README.md` age budget, and the
orchestrator deferred-fix rules): severities/confidences preserved from the review lanes (no
downgrades to justify deferral); every deferral cites file+line, a concrete reason, and the
exit criterion that re-opens it. No newly-deferred row is a contained, unpatched
correctness/security/data-loss bug — each is a test-infrastructure investment on a peer-owned
freshly-landed file, a self-healing narrow race below the actionable bar, a feature gap with an
existing escape hatch, or a correctness-sensitive perf change that needs its own focused cycle.
Deferred work remains bound by repo policy when picked up (GPG-signed conventional+gitmoji
commits, no `--no-verify`, `git pull --rebase` before push, no force-push, Node 24+/TS 6, full
gates).

## D10b-01 — AGG-C10b-01 / CRIT10b-01: grid-picture-fallback recovery handler has no behavioral test

- **Severity/Confidence:** Major / High.
- **Citation:** `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts` (100%
  `readFileSync` + `.toContain`/`.toMatch` source-string assertions); target component
  `apps/web/src/components/grid-picture-fallback-boundary.tsx` (`onErrorCapture` handler that
  swaps `img.src` to the base JPEG, removes `<source>` children, guards re-entry via
  `dataset.fallbackApplied`). Proven no-jsdom pattern: `apps/web/src/__tests__/editable-target.test.ts`.
- **Reason:** the recommended fix extracts the inlined JSX handler out into a plain function so a
  fake-DOM behavioral test can drive it — but the component is the peer loop's freshly-landed
  cycle-28 code (`d985f549`/`36a79146` lineage), which the peer actively iterates on. Modifying a
  peer-owned just-landed source file mid-flight is exactly the conflict the shared-worktree rules
  say to avoid. The handler's runtime logic is verified CORRECT today (critic traced it), so this
  is a test-methodology gap, not an unpatched bug — the same investment class as the open D9b-01
  harness rows.
- **Exit criterion:** the next cycle (either loop) that owns/refactors
  `grid-picture-fallback-boundary.tsx` folds in the extract + fake-DOM behavioral test proving
  first-error recovery, second-error no-op, and the no-ancestor/no-fallback-attr no-op case; any
  real regression in the masonry broken-thumbnail recovery re-opens immediately as a scheduled item.

## D10b-02 — AGG-C10b-07 / C10b-TEST-01: WP11 UX/a11y batch shipped with no behavioral test locks

- **Severity/Confidence:** Medium (test gap; underlying items up to High/High) / High.
- **Citation:** cycle-9b WP11 fixes with no referencing test — `lightbox.tsx` `handleTouchEnd`
  interactive-target guard (AGG9B-23, High/High, a re-fix of a prior touch/click slideshow-restart
  race), `image-zoom.tsx` `touchAction` (AGG9B-24), `photo-viewer.tsx`/`info-bottom-sheet.tsx`
  `aria-pressed`/`aria-expanded`/`aria-controls` (AGG9B-15), `image-manager.tsx` optimistic per-row
  tag revert-on-failure (AGG9B-27), `search.tsx` Cmd/Ctrl+K focused-input guard (AGG9B-28).
- **Reason:** the recommended locks (pure-predicate extraction + fake-DOM behavioral test, per the
  repo's move away from source-contract-only tests) all modify the peer loop's freshly-landed WP11
  component files — same peer-ownership conflict as D10b-01. Underlying code verified correct today.
  Same server-action/component behavioral-harness investment class as the open D9b-01/D9b-05 rows.
- **Exit criterion:** the next cycle that owns/refactors any of these components adds the extracted
  behavioral test (highest priority: the lightbox `handleTouchEnd` guard, which has already
  regressed once); any real regression re-opens immediately as a scheduled item.

## D10b-03 — AGG-C10b-08 (T1/T3/T4): tracer self-healing boundary races

- **Severity/Confidence:** T1 Low / Medium; T3 Low-Medium / Medium; T4 Low / Medium.
- **Citation:**
  - **T1** — `apps/web/src/lib/process-image.ts` (per-size fresh `sharp(inputPath,…)` reopen) ×
    `deleteImage`/`deleteImages` unlinking the original mid-encode: `ENOENT` is caught, rolled
    back, and retried cleanly, but emits a spurious "processing failed" log + one wasted retry.
  - **T3** — restore drain in `apps/web/src/app/[locale]/admin/db-actions.ts` (`runRestoreDrainChecklist`):
    a late fire-and-forget `logAuditEvent(...)` can enter the mutation Set after stage-3
    (`background-db-writes`) already drained it, and stage-5 waits only on mutation slots. Fails
    LOUD (no `--force`; import aborts), not silent.
  - **T4** — `apps/web/src/app/actions/images.ts:265-278` `uploadImages()` topic-existence check:
    unlocked SELECT with a long pre-INSERT window racing a concurrent topic rename/delete; resolved
    safely by the `images.topic` FK-restrict + per-file error handling. Undocumented/untested.
- **Reason:** all three are narrow races at boundaries the design did not explicitly serialize,
  absorbed by pre-existing safety nets (rollback, fail-loud import abort, FK-restrict) into clean
  failures rather than corruption — no data loss, no authz/security impact. Consistent with the
  repo's precedent for deferring self-healing narrow-race polish below the actionable bar.
- **Exit criterion:** T1 — a cycle that adds the per-image processing claim to `deleteImage` (or
  otherwise serializes delete-vs-encode), or any incident where the spurious retry masks a real
  failure. T3 — a cycle that makes stage-5 re-check the mutation Set (not just slots) after
  stage-3, or any restore that aborts on a late audit-log write. T4 — a cycle that documents/locks
  the topic-existence race, or any incident where the FK-restrict surfaces a user-visible upload
  error tied to a concurrent rename.

## D10b-04 — WP6 / AGG9B-06: cross-admin PAT visibility + revocation

- **Severity/Confidence:** Medium / Medium.
- **Citation:** `apps/web/src/lib/admin-tokens.ts` (`revokeToken({ userId, tokenId })`,
  `listTokensForUser(userId)` — both owner-scoped), `apps/web/src/app/actions/lr-tokens.ts`
  (`listLrTokens`/`revokeLrToken` owner-scoped). Schema: `apps/web/src/db/schema.ts:232`
  (`admin_tokens.user_id` `.references(() => adminUsers.id, { onDelete: 'cascade' })`).
- **Reason:** genuinely unimplemented at HEAD, but this is a feature gap, not an unpatched security
  bug: the documented multi-root-admin full-trust model already lets any admin delete any other
  admin (`deleteAdminUser`), and `admin_tokens.user_id` is `onDelete: cascade`, so a remaining
  admin already has a coarse escape hatch (deleting a departed admin's account cascade-revokes
  their tokens). The finer-grained cross-admin list/revoke is a UX/defense-in-depth nicety.
  Adding it is a multi-file feature (lib + action + tokens admin page + i18n + audit + tests) that
  exceeds this converged cycle's tight, low-risk scope. Carried once from cycle-9b (WP6, 1 review
  cycle old) — below the 8-cycle High budget and 16-cycle MED checkpoint.
- **Exit criterion:** a cycle explicitly scoped to admin-token management (or the first incident/
  operator request where the account-delete escape hatch is judged too coarse) implements
  `listAllTokens()` (owner-labeled) + any-admin `revokeTokenById()` with audit of actor+owner,
  keeping creation owner-scoped.

## D10b-05 — AGG-C10b-03 / PERF10b-01: `deleteImages` N sequential single-row INSERTs

- **Severity/Confidence:** Medium / High.
- **Citation:** `apps/web/src/app/actions/images.ts:808-836` (per-row
  `await tx.insert(pendingFileDeletions)…` loop before the batched DELETEs; batch capped at 100 at
  `images.ts:754-756`). Schema: `pending_file_deletions.image_id` is a nullable, NON-unique indexed
  column (`db/schema.ts:136,152`).
- **Reason:** a real Medium perf cost (extended pinned-connection + row/gap-lock window: tens of ms
  same-host, ~100-500 ms on remote MySQL) introduced by cycle-21's durable-cleanup feature — but
  NOT deferred as "don't care." It is a correctness-sensitive delete+durability transaction and the
  clean fix has a genuine subtlety: the perf reviewer's suggested read-back
  `WHERE image_id IN (...)` is ambiguous because `image_id` is not unique (a stale un-drained
  pending row for the same id would over-match), and the multi-row-insert contiguity alternative
  (`id = firstInsertId + index`), while correct under MySQL's single-statement AUTO_INCREMENT
  contiguity, cannot be truly verified by a mock-based unit test (CI has no live MySQL), so a
  mapping mistake would silently break cleanup bookkeeping (orphaned files or wrong pending rows
  drained). On the shipped `network_mode: host` same-host topology the wall-clock benefit is modest
  and the path is admin-only + bounded (≤100). Rushing it into a fast-moving shared worktree
  alongside other changes is the riskier choice; it deserves its own focused cycle.
- **Exit criterion:** a cycle scoped to the `deleteImages` path folds in the single multi-row
  INSERT with a verified id-recovery approach (contiguity with an explicit comment, or a read-back
  that de-duplicates on `image_id`), PLUS a test asserting each `pendingDeletions[i]` maps to the
  correct `imageRecords[i].id`; OR any measurement showing the current loop materially degrades a
  concurrent admin/render path on a remote-MySQL deployment.

## Age-budget check (run-10 loop-B cycle 10b)

- **8-cycle High budget:** no newly-deferred High-severity row is a contained unpatched
  correctness/security/data-loss bug. D10b-01 is a Major test-methodology gap (peer-file conflict,
  code correct today) with a concrete exit criterion; not a code defect. Loop-B's own prior register
  (cycle-9b D9b-01..05) is 1 cycle old; D9b-01 (e2e harness, MED) and D9b-05 (GPS action harness,
  HIGH test-infra) stay open with exit criteria unchanged — D10b-01/D10b-02 chain the same
  peer-file-behavioral-harness investment class rather than duplicating.
- **16-cycle MED checkpoint:** WP6 (D10b-04) is at ~1-2 review cycles since first deferral (carried
  from cycle-9b); well below the 16-cycle checkpoint. No MED row crosses the checkpoint this cycle.
- **Carry-forward register:** `deferred-carry-forward.md` gains the five D10b rows this cycle (via
  the README/register update in WP-C's ledger touch is NOT required — the register update is folded
  into this cycle's docs commit).
