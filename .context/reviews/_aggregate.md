# Latest Aggregate Review

Current aggregate: `cycle-37-2026-06-30/_aggregate.md`

Cycle 37 scheduled three high-severity scanner findings for this cycle:

- `AGG-C37-01` - imported credential mutators can run before the same-origin guard.
- `AGG-C37-02` - `lint:action-origin` silently ignores exported identifier aliases.
- `AGG-C37-03` - multi-callback wrappers can hide unguarded mutators.

Cycle 37 deferred two findings in `.context/plans/cycle-37-2026-06-30-deferred.md`: destructive-policy-bound FK orphan convergence and medium-severity CLIP bootstrap sweep ownership.

---

# Cycle 35 Aggregate Review

Cycle: 35/100
Date: 2026-06-30 KST
Reviewed HEAD: `96160854ebadca1606e9f99b2e6f5bc4689e366c`

## Agent Coverage

Completed review artifacts:

- `code-reviewer.md`
- `security-reviewer.md`
- `perf-reviewer.md`
- `test-engineer.md`
- `architect-debugger-tracer.md`
- `critic-verifier-designer-document.md`

No agent failures were recorded. A sixth native subagent could not be spawned because the thread limit was reached, so the critic/verifier/designer/document sweep was completed locally and recorded in `critic-verifier-designer-document.md`.

Cycle 33 deferred findings were treated as the baseline and were not re-raised unless current HEAD introduced fresh evidence, severity, or scheduling pressure. No Cycle 33 deferred item changed severity or became scheduled now.

## Merged Findings

### AGG-C35-01 - Upload HEAD/304 responses leak file descriptors

Severity: Medium
Confidence: High
Agents: perf-reviewer, critic/verifier

Regions:

- `apps/web/src/lib/serve-upload.ts:166-184`
- `apps/web/src/lib/serve-upload.ts:231-267`
- `apps/web/src/app/uploads/[...path]/route.ts:17-29`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:17-24`
- `apps/web/public/sw.template.js:250-263`

`serveUploadFile()` opens a `FileHandle`, stats it, then returns successful non-stream responses for matching `If-None-Match`, wildcard `If-None-Match`, and `HEAD` without closing the handle. The normal body path transfers ownership to `createReadStream({ autoClose: true })`, but these early returns never create that stream.

Concrete failure scenario: the service worker sends synchronous HEAD ETag probes for many cached derivative tiles. Each probe reaches the route-handler fallback and leaks one descriptor, so repeated warm-gallery visits can push the Node process toward `EMFILE`, breaking image serving and other fd-opening work until process restart or GC finalization.

Fix: close the opened `FileHandle` before every successful non-stream return, or use a `finally` that closes unless stream ownership was transferred. Add focused tests for matching ETag 304, wildcard 304, and HEAD responses.

### AGG-C35-02 - Generic action-origin scanner accepts inverted binary `originError` checks

Severity: High
Confidence: High
Agents: code-reviewer, critic/verifier

Regions:

- `apps/web/scripts/check-action-origin.ts:192-219`
- `apps/web/src/__tests__/check-action-origin.test.ts:37-48`
- `apps/web/src/lib/action-guards.ts:37-43`

The generic server-action scanner treats any binary expression mentioning the `requireSameOriginAdmin()` result variable as a valid early-return guard. This accepts inverted or impossible conditions such as `originError === null`, `originError === false`, or `originError && false`.

Concrete failure scenario: a future mutating server action accidentally writes `if (originError === null) return ...`; trusted same-origin requests exit, hostile cross-origin requests skip the branch and reach the mutation, while `npm run lint:action-origin` still passes.

Fix: accept the canonical truthy guard and only safe non-null comparisons, then add negative fixtures for inverted/neutralized comparisons.

### AGG-C35-03 - Scanners miss imported side-effect helpers before required guards

Severity: Medium
Confidence: High
Agents: test-engineer, critic/verifier

Regions:

- `apps/web/scripts/check-action-origin.ts:248-302`
- `apps/web/scripts/check-public-route-rate-limit.ts:49-268`
- `apps/web/src/__tests__/check-action-origin.test.ts:153-168`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:577-610`

The custom scanner models catch direct DB calls and local helper calls, but imported side-effect helpers can run before `requireSameOriginAdmin()` or before a public route limiter without being classified as guarded work. Focused fixtures accepted an imported write helper before the guard/limiter.

Concrete failure scenario: a future refactor moves an imported helper that writes files, enqueues work, logs audit state, or mutates process state above the guard. The relevant gate stays green because the helper is neither a direct DB method nor a locally discovered mutating helper.

Fix: classify imported function calls whose names start with side-effect verbs (`write`, `delete`, `enqueue`, `log`, `revalidate`, etc.) as mutating/expensive work in both scanners, while leaving pure validation/translation helpers alone. Add negative fixtures to both scanner suites.

### AGG-C35-04 - Histogram worker tests duplicate the algorithm instead of executing the shipped worker

Severity: Medium
Confidence: High
Agents: test-engineer

Regions:

- `apps/web/public/histogram-worker.js:4-36`
- `apps/web/src/components/histogram.tsx:541-542`
- `apps/web/src/__tests__/histogram.test.ts:62-138`

The histogram tests verify the React wrapper by fabricating worker replies and duplicating the worker luminance algorithm in the test. They do not execute the shipped `public/histogram-worker.js` file that browsers load.

Concrete failure scenario: a future edit breaks the public worker's message shape, request id propagation, loop bounds, or P3/sRGB luminance coefficients. The current unit test can still pass because it supplies the expected response itself.

Fix: load the shipped worker in a controlled test harness and invoke `self.onmessage`, then assert the posted histogram shape and P3/sRGB luminance bins.

### AGG-C35-05 - Cycle-34 plan state still marks push/deploy incomplete

Severity: Low
Confidence: Medium
Agents: architect-debugger-tracer, critic/verifier

Regions:

- `.context/plans/README.md:5-8`
- `.context/plans/cycle-34-2026-06-30-plan.md:68-76`

The current reviewed HEAD is the pushed cycle-34 fix commit on `master`/`origin/master`, and the Cycle 35 task context identifies it as the deployed master HEAD, but the committed Cycle 34 plan still says the implementation is in progress and leaves push/deploy unchecked.

Concrete failure scenario: a later cycle reads the plan index, treats Cycle 34 as still active, and duplicates coordination work or reports false predecessor incompletion.

Fix: update the Cycle 34 plan and plan README to record the completed terminal state.

## Deferred Findings

No new Cycle 35 findings are deferred. All five merged findings are scheduled in `.context/plans/cycle-35-2026-06-30-plan.md`.

Cycle 33 deferred items remain recorded in `.context/plans/cycle-33-2026-06-30-deferred.md` with original severity/confidence, reason, and exit criterion.

## Validation During Review

- Security lane ran `npm run lint:api-auth --workspace=apps/web`: passed.
- Security lane ran `npm run lint:action-origin --workspace=apps/web`: passed at reviewed HEAD.
- Security lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Security lane ran focused security/privacy tests: passed.
- Security lane ran `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- Test lane ran `node --check apps/web/public/histogram-worker.js`: passed.
- Test lane ran `node --check apps/web/public/sw.template.js`: passed.
- Code/test lanes reproduced the scanner fail-open cases with focused in-memory fixtures.

## Final Sweep

No new schema/migration/reconcile drift, deploy-script safety regression, UI/accessibility blocker, i18n issue, or photographer-facing product-policy issue reached the reporting bar beyond the five scheduled findings above.
