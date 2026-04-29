# Plan 255 — Cycle 1 RPF fixes

## Context
Cycle 1 Prompt 1 fanned out across 11 reviewer perspectives and produced `.context/reviews/_aggregate.md` with 61 merged findings. This plan schedules the correctness/security/accessibility items selected for Prompt 3 implementation. Deferred non-blocking items are recorded in `plan/plan-256-cycle1-rpf-deferred.md` with severity/confidence preserved.

## Repo rules read
- `CLAUDE.md`: Node 24+/Next 16/React 19/TS 6; strict auth/origin/upload/restore safeguards; single-writer runtime topology is documented; uploads have 200 MiB per-file and 2 GiB rolling batch limits; private originals and public derivatives must both be persisted; secrets must not be reused.
- `AGENTS.md`: always commit and push changes; use gitmoji in commit messages.
- `.context/**`: prior reviews/plans require no silent drops and severity-preserving deferrals.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no repo docs directory present.

## Scheduled implementation items

### Correctness / security / data integrity
- [x] AGG1-01: fix photo prev/next adjacency across `capture_date IS NULL` boundaries and add regression coverage.
- [x] AGG1-02 / AGG1-12 / AGG1-26: harden nginx proxy/rate-limit configuration: preserve trusted edge proto, include `/admin/seo` and `/admin/settings`, add `/api/admin` throttling, and narrow default/login/admin body budgets while keeping upload/restore caps explicit.
- [x] AGG1-03: change CI `BASE_URL` to a production-guard-compatible non-placeholder origin so the build gate does not self-fail.
- [x] AGG1-04: mitigate the large pre-auth Server Action body budget in the supported nginx topology with explicit per-location edge body caps.
- [x] AGG1-06 / AGG1-43: reset image-queue bootstrap cursor when jobs exhaust retries so low-ID pending jobs are revisited; add/update regression coverage.
- [x] AGG1-07: stop counting intra-share `?photoId=` navigation as new shared-group views.
- [x] AGG1-08: stream upload/backup files from the path already resolved during containment checks.
- [x] AGG1-09: validate Settings/SEO action payloads at runtime before trimming values.
- [x] AGG1-10: reject non-array/non-string `batchUpdateImageTags` payloads before iterating.
- [x] AGG1-21: add public share-key lookup rate limiting for `/s/<key>` and `/g/<key>` route renders/metadata.
- [x] AGG1-28: add an account-scoped bounded in-memory login limiter so DB rate-limit outages do not remove the documented per-account fallback.
- [x] AGG1-39: roll back share-create rate-limit counters when a concurrent photo-share request only returns the winner's already-created key.
- [x] AGG1-40: make empty shared groups inaccessible after all images are deleted.
- [x] AGG1-61: decode ICC `mluc` strings as UTF-16BE and byte-bound optional EXIF/ICC metadata before DB insertion.

### Accessibility / UX quick fixes
- [x] AGG1-05: darken the light destructive token and use the destructive foreground token for destructive buttons.
- [x] AGG1-56: enlarge/admin-nav link hit targets and make active states more tappable.

### Test / gate work
- [x] Add targeted tests for fixed behavior where practical: image queue bootstrap reset, auth account limiter, tag payload validation, ICC `mluc`, nginx config/static source contracts, share route limiter/rollback, and file-stream resolved-path contract.
- [x] Run all configured gates from orchestrator: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run lint:api-auth`, `npm run lint:action-origin`.
- [x] Commit and push with signed gitmoji commits.
- [x] Deploy with `npm run deploy` after gates are green (attempted; failed because the required deploy env file is absent).

## Progress log
- [x] Prompt 2 plan authored from aggregate reviews; implementation not started in Prompt 2.
- [x] Prompt 3 implementation complete.
- [x] Gates green.
- [x] Commits pushed.
- [x] Per-cycle deploy attempted; failed because `/Users/hletrd/.gallerykit-secrets/gallery-deploy.env` is missing and no alternate deploy env file was present.


## Implementation notes (2026-04-29)
- Fixed adjacency, group-empty handling, settings/SEO/tag runtime guards, share-count/rate-limit race cases, nginx edge hardening, upload/backup TOCTOU streaming, image-queue bootstrap cursor reset, ICC metadata decoding/bounding, destructive contrast, and admin nav touch targets.
- Added targeted regression/source-contract coverage for the fixed behavior.
- Gate/deploy status is tracked below after the full orchestrator gate run.

## Gate log
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run test` ✅ (78 files / 503 tests)
- `npm run test:e2e` ✅ (20 passed / 2 CI-only checks skipped) using a disposable local MySQL container on port 3307 for the required DB environment.
- `npm run lint:api-auth` ✅
- `npm run lint:action-origin` ✅

## Deploy log
- `npm run deploy` ❌ failed: missing `/Users/hletrd/.gallerykit-secrets/gallery-deploy.env`.
- Recovery attempted: searched for an alternate deploy env/config under the repo, `~/.gallerykit-secrets`, `~/.config`, and SSH-adjacent locations; no deploy env was present. No further deploy attempts were made.
