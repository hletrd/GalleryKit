# Cycle 34 Aggregate Review

Cycle: 34/100
Date: 2026-06-30 KST
Reviewed HEAD: `e1f124a265998ea51297d6716df6c03a2056a96c`

## Agent Coverage

Completed review artifacts:

- `code-reviewer.md`
- `security-reviewer.md`
- `perf-reviewer.md`
- `test-engineer.md`
- `architect-debugger-tracer.md`
- `critic-verifier-designer-document.md`

No agent failures were recorded. A sixth native subagent could not be spawned because the thread limit was reached, so the critic/verifier/designer/document sweep was completed locally and recorded in `critic-verifier-designer-document.md`.

Cycle 33 deferred findings were treated as the baseline and were not re-raised unless the current HEAD introduced fresh evidence. No Cycle 33 deferred item changed severity or became scheduled now.

## Merged Findings

### AGG-C34-01 - Lightroom multipart parse slot leaks on quota early returns

Severity: High
Confidence: High
Agents: code-reviewer, security-reviewer, perf-reviewer, test-engineer, architect-debugger-tracer, critic/verifier

Regions:

- `apps/web/src/app/api/admin/lr/upload/route.ts:60-73`
- `apps/web/src/app/api/admin/lr/upload/route.ts:130-185`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:267-278`

The LR/PAT upload route acquires the singleton multipart parse slot before the upload-tracker quota branches, but releases it only in the later `request.formData()` `finally`. If `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` or `tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES`, the route returns `429` before release.

Concrete failure scenario: an authenticated Lightroom/PAT client reaches the upload window, sends one more valid-header request, and the route leaks `lrMultipartParseInFlight = 1`. Every later LR upload in that Node process returns "Another Lightroom upload is being parsed; retry shortly" until restart, including uploads from other admins/tokens.

Fix: move `tryAcquireLrMultipartParseSlot()` after the quota rejection branches and immediately before the parse/preclaim window, or wrap every post-acquire path in a dominating `try/finally`. Add coverage that quota branches precede slot acquisition and no post-preclaim return can bypass release.

### AGG-C34-02 - Auth action origin scanner accepts inverted `hasTrustedSameOrigin` guards

Severity: High
Confidence: High
Agents: test-engineer, critic/verifier

Regions:

- `apps/web/scripts/check-action-origin.ts:501-527`
- `apps/web/src/__tests__/check-action-origin.test.ts:508-545`
- `apps/web/src/app/actions/auth.ts:97-101`

The Cycle 33 auth-action scanner helper strips an optional `!` and accepts both `hasTrustedSameOrigin(...)` and `!hasTrustedSameOrigin(...)` as valid guard conditions, then only checks that the `then` branch exits. A future auth mutation could accidentally write `if (hasTrustedSameOrigin(headers)) return ...; await db.update(...)`; trusted users would exit, hostile cross-origin requests would fall through to mutation, and `npm run lint:action-origin` would still pass.

Fix: require the auth-specific scanner path to recognize only the untrusted-origin early-exit branch, currently `if (!hasTrustedSameOrigin(...)) { return/redirect/throw }`, and add a negative fixture for the inverted trusted-origin branch.

## Deferred Findings

No new Cycle 34 findings were deferred. Both findings are security/availability correctness regressions and are scheduled in `.context/plans/cycle-34-2026-06-30-plan.md`.

Cycle 33 deferred items remain recorded in `.context/plans/cycle-33-2026-06-30-deferred.md` with original severity/confidence, reason, and exit criterion.

## Validation During Review

- Security lane ran `npm run lint:api-auth --workspace=apps/web`: passed.
- Security lane ran `npm run lint:action-origin --workspace=apps/web`: passed at reviewed HEAD.
- Security lane ran `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Security lane ran focused security/privacy tests: 198 tests passed.
- Security lane ran `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- Architect/debugger/tracer lane ran `npm test --workspace=apps/web -- --run src/__tests__/lr-upload-hdr-gate.test.ts`: passed, demonstrating the reviewed test suite did not yet catch `AGG-C34-01`.

## Final Sweep

No new schema/migration/reconcile drift, deploy-script drift, UI/accessibility blocker, documentation mismatch, or photographer-facing product-policy issue reached the reporting bar beyond the two scheduled regressions above.
