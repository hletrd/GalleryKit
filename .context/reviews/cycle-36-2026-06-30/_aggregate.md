# Cycle 36 Aggregate Review

Cycle: 36/100
Date: 2026-06-30 KST
Reviewed HEAD: `bdfb38a1c39bd828c07851d3d096602441b4122c`

## Agent Coverage

Completed review artifacts:

- `cycle-36-2026-06-30/code-reviewer.md`
- `cycle-36-2026-06-30/security-reviewer.md`
- `cycle-36-2026-06-30/perf-reviewer.md`
- `cycle-36-2026-06-30/test-engineer.md`
- `cycle-36-2026-06-30/architect-document.md`
- `cycle-36-2026-06-30/designer-critic.md`

No agent failures were recorded. The security lane reported no additional actionable findings. Cycle 35 closed findings were not re-raised unless current HEAD introduced fresh evidence.

## Merged Findings

### AGG-C36-01 - Action-origin guard branches can mutate before returning

Severity: High
Confidence: High
Agents: code-reviewer

Regions:

- `apps/web/scripts/check-action-origin.ts:226`
- `apps/web/scripts/check-action-origin.ts:235`
- `apps/web/scripts/check-action-origin.ts:441`
- `apps/web/scripts/check-action-origin.ts:496`
- `apps/web/scripts/check-action-origin.ts:537`
- `apps/web/scripts/check-action-origin.ts:592`

`statementReturnsOnGuard()` and the auth guard path accept a guard block when any statement in the branch returns. They do not prove that the branch returns before side effects. The public analytics exemption path has the same dominance bug: the limiter branch can mutate before returning and still be treated as a valid limiter gate.

Concrete failure scenario: a future action writes `if (originError) { await db.delete(...); return { error: originError }; }`. A hostile cross-origin request would take the rejecting branch and mutate before returning an error, while `npm run lint:action-origin` reports OK.

Fix: make rejecting guard/limiter branches prove a side-effect-free early exit before accepting them. Add negative fixtures for standard action guards, auth-file guards, and public action limiter branches.

### AGG-C36-02 - Action-origin local mutating-helper discovery is order-dependent

Severity: High
Confidence: High
Agents: code-reviewer

Regions:

- `apps/web/scripts/check-action-origin.ts:531`
- `apps/web/scripts/check-action-origin.ts:542`
- `apps/web/scripts/check-action-origin.ts:633`
- `apps/web/scripts/check-action-origin.ts:641`
- `apps/web/scripts/check-action-origin.ts:652`

`checkActionSource()` builds `localMutatingFunctions` in a single pass. A wrapper helper declared before a later DB-writing helper is never revisited after the later helper is classified as mutating.

Concrete failure scenario: `updateFoo()` calls `writeFirst()` before `requireSameOriginAdmin()`, and `writeFirst()` calls `actuallyWrite()` declared later. The scanner currently reports OK even though the exported action performs a pre-guard DB write.

Fix: collect local function bodies and compute mutating helper names to a fixed point before evaluating exports. Add a wrapper-before-mutator regression fixture.

### AGG-C36-03 - Action-origin scanner ignores wrapped and default exported actions

Severity: High
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/scripts/check-action-origin.ts:735`
- `apps/web/scripts/check-action-origin.ts:745`
- `apps/web/scripts/check-action-origin.ts:756`
- `apps/web/scripts/check-action-origin.ts:772`
- `apps/web/src/app/actions/auth.ts:38`
- `apps/web/src/__tests__/check-action-origin.test.ts:434`

The scanner checks direct exported async functions and exported async const functions, but exported call wrappers such as `cache(async function ...)` and default exported async functions can fall through with no pass, skip, or failure. Current source already proves the blind spot because `getCurrentUser` is exported through `cache(...)` and is omitted from scanner output.

Concrete failure scenario: a future mutating server action is wrapped in `cache(...)` or `wrapAction(...)`, omits `requireSameOriginAdmin()`, and keeps the gate green.

Fix: unwrap function-like call-wrapper initializers when possible and otherwise fail closed on unsupported exported call wrappers. Reject default exports in action files. Add a reasoned read-only exemption for the current cached `getCurrentUser` export.

### AGG-C36-04 - Public-route rate-limit scanner misses imported expensive GET helpers

Severity: Medium
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/scripts/check-public-route-rate-limit.ts:60`
- `apps/web/scripts/check-public-route-rate-limit.ts:431`
- `apps/web/scripts/check-public-route-rate-limit.ts:573`
- `apps/web/src/app/uploads/[...path]/route.ts:14`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:14`
- `apps/web/src/lib/serve-upload.ts:61`
- `apps/web/src/lib/serve-upload.ts:189`
- `apps/web/src/lib/serve-upload.ts:281`

The public route scanner marks expensive GETs using local body text markers and local helper bodies. It does not classify imported helper calls like `serveUploadFile(...)`, even though that helper performs config lookup plus file open/stat/stream work. The two upload fallback routes are currently classified as cheap with no explicit exemption.

Concrete failure scenario: a public GET route moves DB, image, or filesystem work behind an imported helper and ships without either a limiter or a reasoned exemption.

Fix: classify `serveUploadFile(...)` as expensive imported GET work, add explicit upload-route exemptions documenting why public derivative serving is intentionally not rate-limited, and fail closed on bodyless named GET re-exports from another module.

### AGG-C36-05 - `reconcileLegacySchema` does not repair the admin-token owner FK

Severity: High
Confidence: High
Agents: architect-document

Regions:

- `apps/web/src/db/schema.ts:200`
- `apps/web/scripts/migrate.js:565`
- `apps/web/scripts/migrate.js:684`
- `apps/web/src/app/actions/admin-users.ts:251`
- `apps/web/src/lib/admin-tokens.ts:146`
- `apps/web/src/lib/api-auth.ts:72`

The `admin_tokens.user_id -> admin_users.id ON DELETE CASCADE` FK exists in schema and create-table DDL, but `reconcileLegacySchema()` does not explicitly repair it when a legacy table already exists without the FK. `verifyToken()` also trusts an `admin_tokens` row without confirming the owner admin still exists.

Concrete failure scenario: a legacy DB has `admin_tokens` rows but lacks `admin_tokens_user_fk`. Deleting an admin does not cascade token rows, and a surviving PAT can still authenticate as the deleted admin because verification reads only `admin_tokens`.

Fix: add explicit FK convergence for `admin_tokens_user_fk` and other current create-only FK constraints, and make `verifyToken()` join `admin_users` so orphan token rows fail closed even before FK repair.

### PERF-C36-01 - Bootstrap orphan-temp cleanup repeats on every queue continuation

Severity: Medium
Confidence: High
Agents: perf-reviewer

Regions:

- `apps/web/src/lib/image-queue.ts:80`
- `apps/web/src/lib/image-queue.ts:885`
- `apps/web/src/lib/image-queue.ts:925`
- `apps/web/src/lib/image-queue.ts:1007`
- `apps/web/src/lib/image-queue.ts:1013`
- `apps/web/src/lib/process-topic-image.ts:135`

Large bootstrap backlogs can run full orphan-temp directory scans after every 500-image continuation. This can create avoidable startup filesystem pressure on large galleries.

Fix: gate orphan cleanup separately from continuation batches or move repeated cleanup to the hourly GC cadence.

### PERF-C36-02 - Per-photo OG generation cannot 304 unchanged revalidations

Severity: Medium
Confidence: High
Agents: perf-reviewer

Regions:

- `apps/web/src/app/api/og/photo/[id]/route.tsx:58`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:118`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:134`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:223`
- `apps/web/src/app/api/og/route.tsx:118`

The per-photo OG route performs DB/config reads, internal derivative fetches, Satori rendering, and Sharp JPEG processing on revalidation because it has no ETag/304 path. The sibling topic OG route already has an input-hash ETag.

Fix: add a per-photo OG ETag that covers render-affecting image and SEO inputs before derivative fetch and Satori work.

### PERF-C36-03 - CLIP image preprocessing ignores the tunable input-pixel cap

Severity: Low
Confidence: Medium
Agents: perf-reviewer

Regions:

- `apps/web/src/lib/process-image.ts:352`
- `apps/web/src/lib/process-image.ts:922`
- `apps/web/src/lib/clip-model.ts:273`
- `apps/web/src/lib/clip-model.ts:290`
- `apps/web/scripts/backfill-clip-embeddings.ts:185`

The main image pipeline honors `IMAGE_MAX_INPUT_PIXELS`, but CLIP image preprocessing uses Sharp without that deployment cap. Sharp still has its own default pixel guard, so this is a deployment-tuning mismatch rather than an unbounded decode.

Fix: share the same cap with CLIP preprocessing or add a CLIP-specific cap that defaults to the pipeline cap.

### C36-DES-01 - Pagination errors are not announced by the component status region

Severity: Medium
Confidence: High
Agents: designer-critic

Regions:

- `apps/web/src/components/load-more.tsx:49`
- `apps/web/src/components/load-more.tsx:61`
- `apps/web/src/components/load-more.tsx:72`
- `apps/web/src/components/load-more.tsx:81`
- `apps/web/src/components/load-more.tsx:165`

Load-more failure branches show toast errors but leave the component live region with the prior loading text. Screen-reader users can miss the failure state if the toast is not exposed reliably.

Fix: update `statusMessage` on every failure branch and consider a local inline retry/error status.

### C36-DES-02 - Public semantic-search setup errors expose operator jargon

Severity: Medium
Confidence: High
Agents: designer-critic

Regions:

- `apps/web/src/components/search.tsx:199`
- `apps/web/messages/en.json:426`
- `apps/web/messages/ko.json:426`

Public semantic search setup failures surface model-weight, production-mode, and embedding-backfill terms to visitors. That belongs in operator/admin surfaces, not the public search dialog.

Fix: replace public copy with visitor-safe fallback guidance and keep operational detail in admin/runbook contexts.

### C36-DES-03 - Upload rejection toasts can bypass localization

Severity: Low
Confidence: High
Agents: designer-critic

Regions:

- `apps/web/src/components/upload-dropzone.tsx:205`
- `apps/web/src/components/upload-dropzone.tsx:217`
- `apps/web/messages/en.json:550`
- `apps/web/messages/ko.json:550`

`react-dropzone` rejection messages are interpolated directly into upload toasts, which can expose English library strings in the Korean admin UI.

Fix: map `FileError.code` to app-owned localized upload messages with a generic fallback.

## Scheduled This Cycle

- AGG-C36-01
- AGG-C36-02
- AGG-C36-03
- AGG-C36-04
- AGG-C36-05

## Deferred Findings

Deferred items are recorded in `.context/plans/cycle-36-2026-06-30-deferred.md` with severity/confidence, reason, and exit criterion:

- PERF-C36-01
- PERF-C36-02
- PERF-C36-03
- C36-DES-01
- C36-DES-02
- C36-DES-03

## Validation During Review

- Code-review lane ran `npm run lint:action-origin --workspace=apps/web`: passed on reviewed HEAD.
- Code-review lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed on reviewed HEAD.
- Code-review lane ran focused scanner/serve-upload/histogram tests: passed, 130 tests.
- Security lane ran `npm run lint:api-auth --workspace=apps/web`: passed.
- Security lane ran `npm run lint:action-origin --workspace=apps/web`: passed.
- Security lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Security lane ran production `npm audit --omit=dev --workspace=apps/web --json`: 0 vulnerabilities.
- Security lane ran targeted privacy/secrets/scanner tests: passed.
- Test lane ran full Vitest: passed, 2601 tests / 4 skipped.
- Architect lane ran targeted migration/privacy/admin-token tests: passed, 107 tests.

## Final Sweep

The highest-risk current-cycle issues are scanner fail-open cases and the admin-token FK reconciliation/authentication boundary. Lower-priority performance and UX items are tracked for follow-up without blocking this cycle.
