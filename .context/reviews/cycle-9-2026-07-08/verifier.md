# Verifier Report — Cycle 9 (evidence-based correctness vs. stated behavior)

Date: 2026-07-08
Verified HEAD: `6efd737b3ad5791c662fded4801701992684e54d` (branch `master`, clean working
tree, `up to date with 'origin/master'` per `git status`)
Method: read-only. Compared `CLAUDE.md`, `.context/plans/README.md`,
`cycle-18-2026-07-08-plan.md`, `cycle-8b-2026-07-07-plan.md`, and the Cycle 18
aggregate against the actual source/tests at HEAD via `git show`/`git log`/`grep`/`Read`.
No build/test/lint was run (out of scope for this lane).

## Summary

- 5 findings below (VER9-01 .. VER9-05).
- 4 of 4 spot-checked "closed" Cycle 18 findings (WP1-WP4) are **genuinely closed**:
  the source changes match the plan's stated fix, and where the plan promised
  behavior-level test coverage, real behavioral tests exist and exercise the
  claimed code path (not just source-string assertions).
- 1 confirmed **ledger/doc-vs-reality gap**: the Cycle 18 plan's own commit is
  pushed to `origin/master` (verified HEAD), but the plan document still describes
  commit/push as in-progress, and no Cycle 18 deploy transcript exists anywhere in
  the repo — compounding an already-open Cycle 17 deploy gap the Cycle 18 plan
  itself acknowledged. Two cycles of pushed correctness/security fixes (including
  the PAT `last_used_at` timing fix, VER9-01 below) now sit undeployed as far as
  committed evidence shows.

## Findings

### VER9-01 — WP2 (PAT `last_used_at` route-admission ordering) is genuinely closed, with real behavior tests — CONFIRMED

- Confidence: High
- Citations: `apps/web/src/lib/api-auth.ts:19-28,66-100`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-160`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:216-314`, `apps/web/src/__tests__/api-auth-response-headers.test.ts:46-170`
- Claim (cycle-18 plan WP2 / aggregate `AGG-C18-10`): stop marking scoped PAT
  `last_used_at` before route-specific admission gates; pass verified token
  context through the wrapper so the LR upload handler marks use only after
  restore-maintenance and cheap admission checks pass.
- Verified: `withAdminAuth` (`api-auth.ts:66-120`) now only stores the verified
  token in a `WeakMap`/exposes `getAdminAuthToken`; the actual `markTokenUsed` DB
  write is deferred to an explicit `markAdminAuthTokenUsed(request)` call
  (`api-auth.ts:23-28`) that the route must invoke itself. The LR upload route
  calls it at line 160 — **after** the restore-maintenance check (line 94-99),
  Content-Length/size checks, upload-quota checks, and the multipart-parse-slot
  acquisition, but before any DB insert/queue work.
  `lr-upload-route-behavior.test.ts:293-314` drives the actual route handler with
  `isRestoreMaintenanceActiveMock.mockReturnValue(true)` and asserts
  `markAdminAuthTokenUsedMock` was **not** called; the admitted-path test at
  line 216-286 asserts it **was** called once. Both are real behavior tests (they
  invoke the imported `POST` handler with a real `NextRequest`), not source-shape
  string pins.
- Verdict: claim matches code and is backed by executable proof. No corrective
  action needed.

### VER9-02 — WP3 (CLIP/pipeline documentation contracts) is genuinely closed on all 4 sub-items — CONFIRMED

- Confidence: High
- Citations: `apps/web/src/lib/process-image.ts:371-374`, `apps/web/src/lib/gallery-config-shared.ts:10-22`, `apps/web/src/app/actions/embeddings.ts:89-202`, `apps/web/src/__tests__/embeddings-action-behavior.test.ts:237-256`, `apps/web/scripts/backfill-clip-embeddings.ts:45-52`, `CLAUDE.md:599`
- Claim (WP3 / aggregate `AGG-C18-11..14`): (1) remove the stale duplicate
  pipeline-version history from `process-image.ts`; (2) close the CLIP server
  action's skipped-prefix starvation shape; (3) fix CLIP runbook wording from
  "candidate-row limit" to "embedding-attempt budget"; (4) replace the stale
  future-tense ONNX/concurrency comment.
- Verified individually:
  1. `process-image.ts:368-377` now only re-exports `IMAGE_PIPELINE_VERSION` from
     `gallery-config-shared.ts`, whose own history comment (`gallery-config-shared.ts:10-22`)
     is the sole v2-v7 ledger. The old v2-v6-only duplicate block (missing v7) is gone.
  2. `embeddings.ts`'s `backfillClipEmbeddings` was rewritten to the sidecar's
     keyset-cursor pattern (`cursor`/`gt(images.id, cursor)`) plus an
     `attemptedEmbeddings`/`remainingEmbeddingBudget` counter, matching the
     sidecar exactly. A genuine regression test
     (`embeddings-action-behavior.test.ts:237-256`, "continues past skipped
     production rows to later valid rows in the same run") feeds a
     missing-original row (id 20) followed by a valid row (id 21) and asserts
     the valid row is still processed (`processed: 1, skipped: 1`) — this is the
     exact starvation scenario the finding described, reproduced and pinned.
  3. `CLAUDE.md:599`, `apps/web/README.md:85`, and the sidecar script header
     (`backfill-clip-embeddings.ts:45-49`) all now say `SEMANTIC_SCAN_LIMIT` caps
     embedding *attempts*, and that missing-original rows advance the cursor
     without consuming that budget.
  4. `backfill-clip-embeddings.ts:51-52` now reads "Concurrency is fixed at
     BATCH_CONCURRENCY=2 for this sidecar. Add a bounded env/CLI knob with tests
     before making it operator-tunable" — the stale "raise it once real ONNX
     ships" language is gone (ONNX already ships; the finding's exact complaint).
- Verdict: all 4 sub-claims match code. No corrective action needed.

### VER9-03 — WP4 (mobile tag-filter disclosure + README wording) is genuinely closed — CONFIRMED

- Confidence: High
- Citations: `apps/web/src/components/tag-filter.tsx` (diff in `6efd737b`), `README.md` (diff in `6efd737b`)
- Claim (WP4 / aggregate `AGG-C18-15`, `-19`, `-20`): collapse the mobile tag list
  behind an accessible disclosure so the photo grid appears closer to the first
  viewport, preserving touch targets; soften "Live Demo" and "Photographer-grade
  color management" README wording to avoid overclaiming.
- Verified: `tag-filter.tsx` now wraps the same chip markup in a `<details
  className="group sm:hidden">`/`<summary>` disclosure (44 px `min-h-11` summary,
  `focus-visible` ring, `[&::-webkit-details-marker]:hidden`) for mobile, and an
  always-visible `hidden sm:flex` version for `sm:` and up — native `<details>`
  is keyboard-operable by default, satisfying the "keyboard access" acceptance
  bullet without extra JS. `README.md` changed "Live Demo" → "Example deployment"
  and added an explicit caveat paragraph ("may include deployment-specific
  content, branding, settings, and model/search state"), and softened
  "Photographer-grade color management" → "Photographer-oriented color
  pipeline" with an added "public HDR delivery is not shipped yet" clause.
- Note: the plan listed `apps/web/src/components/home-client.tsx` as a candidate
  file, but only `tag-filter.tsx` was actually touched — this is not a defect;
  the fix is fully self-contained in the filter component and the acceptance
  criteria are met without a `home-client.tsx` change. Listing an unused
  candidate file in a plan is not itself a ledger inconsistency.
- Verdict: claim matches code. No corrective action needed.

### VER9-04 — WP1 ledger reconciliation is real, but a second undeployed-push gap has now accumulated on top of the one WP1 fixed — CONFIRMED (process/ledger finding, not a code defect)

- Confidence: High
- Citations: `.context/plans/README.md:34-39` ("Active Current-Cycle Plans" lists
  only Cycle 18), `.context/plans/cycle-17-2026-07-08-plan.md` ("Terminal
  Evidence" section, "Deploy evidence gap: ... Cycle 18 deploy pass supersedes
  the production-state proof after the Cycle 18 commit is pushed"),
  `.context/plans/cycle-18-2026-07-08-plan.md:1-4,133-140` (Status line +
  Progress checklist), `.context/plans/deferred-carry-forward.md:19` (checkpoint
  updated to "run-10 c18"), `git log`/`git status` (this session)
- What WP1 fixed (verified true): Cycle 17 is no longer listed as the active
  plan in `README.md` (moved to "Recently Completed"); Cycle 18 is now the sole
  active-ledger entry; the carry-forward age-budget checkpoint line was advanced
  from the stale "run-10 c4" to "run-10 c18". These are exactly WP1's stated
  acceptance criteria and all hold.
- The gap: Cycle 17's own plan explicitly deferred its deploy-evidence gap to
  "Cycle 18's deploy pass, after the Cycle 18 commit is pushed." The Cycle 18
  plan (`cycle-18-2026-07-08-plan.md:1-4`) is itself committed inside `6efd737b`
  and still reads `Status: IMPLEMENTED + LOCAL GATES GREEN; COMMIT/PUSH/DEPLOY
  FINALIZATION IN PROGRESS`, and its Progress checklist's last line — `[ ] WP5
  signed commit/push and per-cycle deploy finalization` — is unchecked.
  Externally verifiable fact from this session: `6efd737b` **is** on
  `origin/master` (`git status` reports "up to date with 'origin/master'",
  `nothing to commit, working tree clean") — so the push half of that checkbox
  already happened by the time this verifier ran. But no follow-up commit
  analogous to the Cycle 8b loop's two `docs(plan)` commits (`63254c36` gate
  evidence, `57c9d669` deploy success) exists recording a Cycle 18 deploy
  attempt or outcome anywhere in `git log`. Per `CLAUDE.md`'s own stated policy
  ("The deploy is per-iteration by project policy — every commit pushed to
  master is followed by a deploy"), that means as of verified HEAD there are
  now **two** cycles (17 and 18) of pushed, gate-green fixes — including the
  PAT-auth-timing fix in VER9-01, which is a genuine security-adjacent
  correctness fix — with no committed evidence they have reached production.
- Failure scenario: if a subsequent cycle's review or the deploy skill assumes
  "pushed ⇒ deployed" (as several historical entries in `README.md`'s "Recent
  Plans" section do, e.g. Cycle 6/Cycle 97 record explicit deploy hashes), it
  could under-report the live/deployed-code gap, or an operator reading only the
  Cycle 18 plan's top status line could wrongly assume deploy is still pending
  when the push already landed.
- Suggested fix: whichever lane runs next (fix/deploy lane) should either (a)
  run `npm run deploy` now and record a terminal "Deploy record" section in
  `cycle-18-2026-07-08-plan.md` (mirroring the Cycle 8b plan's pattern) with the
  actual commit hash, smoke-check results, and disk/prune status, or (b) if a
  deploy genuinely cannot run this session, update the plan's status line and
  checklist to accurately reflect "committed + pushed; deploy pending" rather
  than "IN PROGRESS," and open an explicit carry-forward row for the
  accumulating undeployed-push gap the way `AGG-C18-18` already frames the
  general live-state-unverifiable pattern.
- Verdict: not a code-behavior bug; a documentation/ledger currency gap that is
  real as of this verification and worth closing before it compounds further.

### VER9-05 — Test-file-count sanity check is consistent with the Cycle 18 plan's claimed gate evidence — CONFIRMED (light check)

- Confidence: Medium (file-count proxy only; suites were not executed by this lane)
- Citations: `cycle-18-2026-07-08-plan.md:151` ("354 files passed, 2 skipped"),
  `find apps/web/src/__tests__ -name '*.test.ts*' | wc -l` → 356
- 354 passed + 2 skipped = 356, matching the on-disk test file count exactly.
  This is a weak but real cross-check (a file-count claim that was off would
  have been an immediate red flag); it is consistent with the plan's numbers.
  A full run was intentionally left to the gate/verification lane that
  actually executes `npm test`.
- Verdict: no discrepancy found; no action needed beyond the other lane's own
  gate re-run.

## Findings not pursued further (in-scope but lower priority)

- `AGG-C18-06`'s deferred remainder (advisory-lock and LR-setup-failure branches
  in `cycle-17-source-contracts.test.ts` remain source-shape-only) is
  **correctly** left partially open — the Cycle 18 plan only committed to "at
  least one" branch gaining behavior coverage, which VER9-02 confirms happened
  for the CLIP branch. This is not a broken promise.
- `AGG-C18-18` ("live deployment/operator state outside static proof") is
  properly deferred with an honest exit criterion that already anticipates
  VER9-04's concern ("Reopen ... if a cycle/deploy completion ledger lacks
  deploy transcript and smoke evidence") — the register already has the right
  shape to receive VER9-04's finding; it just hasn't been reopened/tied to
  Cycle 18 specifically yet.
