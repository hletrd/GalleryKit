# Debugger Review - Cycle 24

Review role: debugger  
Repository: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `a6efd6fd584fe44138be3729d90743ceb76dbfad`  
Date: 2026-06-30 KST  
Mode: review-only. I modified only this report file.

## Bug-Prone Inventory First

Read before findings:

- `AGENTS.md` instructions from the prompt, plus project rules embedded there.
- `CLAUDE.md` for architecture, security, deployment, migration, color/HDR, upload, and semantic-search contracts.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md` for the review output contract.

Inventoried and reviewed current HEAD source/docs across these high-risk surfaces:

- Ingest and image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/lib/serve-upload.ts`.
- Auth, origin, abuse, and privacy gates: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, public/admin API routes, public server actions, share/group pages, privacy-sensitive data projections.
- Data, search, and schema behavior: `apps/web/src/lib/data.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, semantic search/similar routes, embeddings, migrations, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`.
- Operational/destructive workflows: admin DB backup/restore, SQL restore scanning, migration reconciliation, deploy documented contracts, queue shutdown/bootstrap, retention/GC.
- Client async/interaction failure modes: search, similar photos, photo navigation, photo viewer, lightbox, image zoom, upload dropzone, histogram, settings backfill UI, load-more, home scroll restoration, map rendering.
- Static sweeps included raw SQL, file operations, spawns, unhandled promises/catches, timers/listeners, auth wrappers, same-origin guards, public mutating route rate limits, `dangerouslySetInnerHTML`, CSP, TODO/FIXME/unsafe/exempt comments.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 2 confirmed issues
- Risks needing manual validation: 1

## Confirmed Issues

### DBG24-01 - Photo swipe state is not reset when the browser cancels a touch

Severity: Low  
Confidence: High  
Status: Confirmed issue  
File/region: `apps/web/src/components/photo-navigation.tsx:60-151`

Evidence:

- Touch start resets `isSwiping`/snap state: `apps/web/src/components/photo-navigation.tsx:60-65`.
- Touch move can set `isSwiping.current = true` and a non-zero `swipeOffset`: `apps/web/src/components/photo-navigation.tsx:67-107`.
- Touch end is the only path that navigates or snaps back: `apps/web/src/components/photo-navigation.tsx:109-142`.
- The component registers `touchstart`, `touchmove`, and `touchend`, but no `touchcancel`: `apps/web/src/components/photo-navigation.tsx:144-151`.

Failure scenario / reproduction idea:

On a touch device, begin a horizontal swipe on the photo page and trigger a browser-level cancel before `touchend` fires, for example an interrupted gesture, page visibility interruption, or a synthetic `touchcancel` in a browser test after `touchmove`. The component can keep the photo container translated because `swipeOffset` and `isSwiping.current` are not reset until a future touch sequence or rerender.

Concrete fix:

Add a `handleTouchCancel` that sets `isSnapping(true)`, `setSwipeOffset(0)`, and `isSwiping.current = false`, then register/remove it alongside `touchend`. Add a focused interaction test that dispatches `touchstart`, horizontal `touchmove`, then `touchcancel` and asserts the transform snaps back.

### DBG24-02 - Similar-photos fetch can update state after unmount and cannot be aborted

Severity: Low  
Confidence: High  
Status: Confirmed issue  
File/region: `apps/web/src/components/similar-photos.tsx:69-90`

Evidence:

- Expanding the panel starts an async fetch: `apps/web/src/components/similar-photos.tsx:69-77`.
- After the awaited network/body work, every branch calls `setResults(...)` and the `finally` calls `setLoading(false)`: `apps/web/src/components/similar-photos.tsx:78-90`.
- The component imports only `useState` and `useRef`, with no unmount cleanup or abort controller: `apps/web/src/components/similar-photos.tsx:3`, `apps/web/src/components/similar-photos.tsx:67`.

Failure scenario / reproduction idea:

In production semantic-search mode, open a photo, expand "Similar photos", then navigate to another photo or close the viewer while `/api/search/similar/[id]` is still pending. When the response resolves, the old component attempts to set state after unmount and the request keeps running even though its UI owner is gone.

Concrete fix:

Track an `AbortController` and mounted flag in `useEffect` cleanup. Pass `signal` to `fetch`, abort on unmount, and guard all post-await state commits. Consider resetting `fetchedRef` on abort so a remounted panel can retry rather than caching an aborted attempt as fetched.

## Likely Issues

No additional likely source bugs survived this pass. Candidate issues in upload quota settlement, settings backfill timers, histogram worker cleanup, semantic search stale-response handling, CSP production sources, and DB restore stream cleanup were checked against current HEAD and had matching guards or compensating tests/comments.

## Risks Needing Manual Validation

### DBG24-RISK-01 - Reverse-proxy IP trust remains configuration-dependent

Severity: Medium if misconfigured, otherwise none  
Confidence: High  
Status: Manual deployment validation risk, not a confirmed source bug  
File/region: `apps/web/src/lib/rate-limit.ts:164-192`, `CLAUDE.md:97`, `CLAUDE.md:660`

Evidence:

- `getClientIp` trusts forwarded headers only when `TRUST_PROXY === 'true'`: `apps/web/src/lib/rate-limit.ts:164-178`.
- Without that flag, proxy traffic with forwarded headers falls back to the shared `"unknown"` bucket and logs once: `apps/web/src/lib/rate-limit.ts:190-192`.
- The docs require `TRUST_PROXY=true` behind nginx/reverse proxy: `CLAUDE.md:97`, `CLAUDE.md:660`.

Failure scenario / reproduction idea:

Deploy behind nginx without `TRUST_PROXY=true`. All public users share one rate-limit identity. A few failed logins or public search/load-more bursts from any client can rate-limit unrelated users until the window expires.

Concrete fix:

Validate production deploy env explicitly: fail startup or health-check loudly when proxy headers are present but `TRUST_PROXY` is missing in a reverse-proxy deployment. At minimum, include this in deploy smoke checks.

## Confirmed Non-Findings / Revalidated Areas

- Lightroom multipart upload quota settlement is correct: it preclaims declared bytes, then `settleUploadTrackerClaim` subtracts claimed bytes and adds actual successful file bytes (`apps/web/src/lib/upload-tracker.ts:19-32`; LR settlement region `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`, `apps/web/src/app/api/admin/lr/upload/route.ts:477-485`).
- Admin API auth scanner passed for current routes.
- Mutating server-action same-origin scanner passed; read-only/public exemptions were explicit.
- Public mutating route rate-limit scanner passed.
- Production CSP does not include development `unsafe-eval`; dev relaxations are isolated to `isDev` (`apps/web/src/lib/content-security-policy.ts:87-123`).
- Settings backfill post-trigger timers have unmount cleanup and a mounted guard (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:90-143`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:203-211`).
- Search and histogram async paths already use request ids, abort controllers, or mounted/aborted guards (`apps/web/src/components/search.tsx:143-260`, `apps/web/src/components/histogram.tsx:549-590`).
- Server-side upload, queue, restore, migration, privacy projection, semantic search, and smart-collection paths contain current guard logic for the prior classes I checked: quota rollback, advisory locks, restore SQL scanning, migration postconditions, public data omission, same-origin/rate-limit gates, and query validation.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `git status --short` - showed pre-existing modified review files only before this report edit; no source files were changed.

Static review sweeps:

- `rg --files`, `git ls-files`, and targeted `nl -ba` reads over app source, scripts, migrations, config, docs, tests related to the inspected surfaces.
- Grep sweeps for async cleanup, timers/listeners, fetches, file operations, child processes, raw SQL, dangerous HTML, auth wrappers, origin guards, public mutating API handlers, CSP, upload tracker settlement, `TRUST_PROXY`, and TODO/FIXME/unsafe/exempt markers.

## Missed-Bug Sweep

Final pass re-checked the newest HEAD for stale assumptions from earlier cycles. The two reported issues are current in HEAD. I intentionally did not repeat old findings already addressed by current code comments/tests unless current code still exhibited the failure mode.

Skipped-file confirmation:

- Skipped generated/build/dependency artifacts: `apps/web/.next/**`, `node_modules/**`, `*.tsbuildinfo`, Playwright/test output artifacts, and built static outputs.
- Skipped binary media/screenshot fixtures except where filenames or routing behavior mattered.
- Skipped historical archived review/plan files as evidence sources except for current project instructions; they are not runtime source.
- Did not modify source files, tests, migrations, configs, or docs other than this review report.
