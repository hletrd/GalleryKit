# Deferred Review Coverage — Cycle 2 Ultradeep

**Created:** 2026-04-22
**Status:** TODO
**Purpose:** Preserve cycle-2 ultradeep findings that are valid but broader than this cycle’s bounded implementation lane.

| Finding / risk | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| Session/auth verification coverage is still shallow | `.context/reviews/test-engineer.md` finding 2 | HIGH / High | Adding realistic auth/session tests requires broader mocking of cookies, redirects, DB reads, and time-based token expiry than fits this cycle’s tighter deploy/branding/privacy lane. | Re-open in the next auth-focused test cycle. |
| `uploadImages()` action and queue pipeline still lack direct regression coverage | `.context/reviews/test-engineer.md` findings 3-4 | HIGH / High | Upload and queue coverage would require a substantial mocked integration harness spanning filesystem, DB, queue state, and image-processing behavior. | Re-open in the next upload/queue hardening cycle. |
| File-serving/download route security behavior is still under-tested | `.context/reviews/test-engineer.md` finding 5 | MEDIUM / High | Route-level temp-file and symlink coverage is valuable but orthogonal to this cycle’s targeted code fixes. | Re-open when file-serving or backup-download code changes next. |
| Default admin E2E and screenshot coverage still under-assert outcomes | `.context/reviews/test-engineer.md` findings 6-7 | MEDIUM / High | CI/E2E strategy changes are broader workflow/test-program work, not a narrow code fix. | Re-open when the Playwright lane is expanded or made CI-default. |
| Share-link creation still spends rate-limit budget before cheap argument validation | local cycle-2 review of `apps/web/src/app/actions/sharing.ts:61-205` | LOW / Medium | The pattern is real but lower-severity than the user-requested deploy/branding/privacy fixes; changing it should be reviewed together with the repo’s pre-increment anti-TOCTOU policy. | Re-open when sharing/rate-limit UX is revisited. |
| Mutable `image_sizes` can point existing content at missing derivatives | architect subagent review `Finding 2`, `apps/web/src/app/actions/settings.ts:35-86`, `apps/web/src/lib/process-image.ts:345-423`, public readers under `apps/web/src/app/[locale]/(public)/**` and `apps/web/src/components/home-client.tsx` | HIGH / High | The risk is real, but choosing between locking the setting, backfilling derivatives, or adding legacy-size fallbacks is a broader product/runtime decision than this cycle can safely finish. | Re-open when image-size migration policy is approved. |
| Shared-group view counts remain intentionally lossy and process-local | architect subagent review `Finding 3`, `apps/web/src/lib/data.ts:9-104` | MEDIUM / High | Making counters durable would require a bigger storage/queue policy change beyond this cycle’s bounded fix lane. | Re-open when analytics/count accuracy becomes a product requirement. |
| Storage backend abstraction remains partially integrated and easy to over-trust | architect subagent review `Finding 5`, `apps/web/src/lib/storage/**`, `apps/web/messages/en.json:532-539` | LOW / Medium | This is real architectural drag, but removing or finishing the abstraction is broader than the current cycle’s targeted fixes. | Re-open when storage architecture is actively simplified or fully integrated. |

## Notes
- Severity/confidence are preserved from the source review; deferral does not reduce risk.
- This file covers only findings not implemented in Plan 176 during the current cycle.
