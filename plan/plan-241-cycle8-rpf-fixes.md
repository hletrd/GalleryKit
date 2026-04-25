# Plan 241 — Cycle 8 RPF implementation fixes
Status: done

## Source reviews
- Aggregate: `.context/reviews/_aggregate.md` (Cycle 8 RPF, 51 consolidated findings)
- Per-agent provenance: `.context/reviews/{code-reviewer,security-reviewer,test-engineer,debugger,designer,critic,verifier,dependency-expert,document-specialist,perf-reviewer,architect,tracer}.md`

## Repo rules read before planning
- `CLAUDE.md` — Next.js 16 / React 19 / TypeScript 6 baseline, local-only storage, single web-instance/single-writer topology, security lint gates, trusted-proxy requirements, public route freshness policy, no supported object-storage switching.
- `AGENTS.md` — always commit/push changes, use gitmoji, keep diffs small/reviewable/reversible, no new dependencies without explicit request, run lint/typecheck/build/tests/static analysis after changes.
- `.context/**` and existing `plan/**` — prior deferrals for broad test-hardening, distributed coordination, storage abstraction, visual-baseline policy, CSV streaming, dependency advisories, and historical secret rotation were reviewed to avoid duplicating already-open product/ops work.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/` policy files are absent.

## Archive action
- Archived completed prior plans: `plan/done/plan-223-cycle8-rpl-polish.md`, `plan/done/plan-239-cycle7-rpf-fixes.md`.

## Disposition map

| Finding | Severity / confidence | Disposition |
|---|---:|---|
| C8RPF-01 | MEDIUM / HIGH | Scheduled P241-01 |
| C8RPF-02 | MEDIUM / HIGH | Scheduled P241-01 |
| C8RPF-03 | LOW / MEDIUM | Scheduled P241-02 |
| C8RPF-04 | HIGH / HIGH | Scheduled P241-02 |
| C8RPF-05 | HIGH / HIGH | Scheduled P241-02 |
| C8RPF-06 | HIGH / HIGH | Scheduled P241-02 |
| C8RPF-07 | MEDIUM / HIGH | Scheduled P241-02 |
| C8RPF-08 | MEDIUM / HIGH | Scheduled P241-03 |
| C8RPF-09 | MEDIUM / HIGH | Scheduled P241-03 |
| C8RPF-10 | MEDIUM / HIGH | Scheduled P241-04 |
| C8RPF-11 | MEDIUM / HIGH | Scheduled P241-04 |
| C8RPF-12 | MEDIUM / HIGH | Scheduled P241-04 |
| C8RPF-13 | MEDIUM / HIGH | Scheduled P241-04 |
| C8RPF-14 | MEDIUM / HIGH | Scheduled P241-04 |
| C8RPF-15 | MEDIUM / HIGH | Scheduled P241-03 |
| C8RPF-16 | MEDIUM / HIGH | Scheduled P241-03 |
| C8RPF-17 | MEDIUM / HIGH | Scheduled P241-03 |
| C8RPF-18 | MEDIUM / MEDIUM | Scheduled P241-03 |
| C8RPF-19 | MEDIUM / HIGH | Scheduled P241-05 |
| C8RPF-20 | LOW / HIGH | Scheduled P241-05 |
| C8RPF-21 | LOW / HIGH | Scheduled P241-05 |
| C8RPF-22 | MEDIUM / HIGH | Scheduled P241-05 |
| C8RPF-23 | LOW / HIGH | Scheduled P241-05 |
| C8RPF-24 | LOW / HIGH | Scheduled P241-05 |
| C8RPF-25 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-26 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-27 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-28 | LOW / HIGH | Scheduled P241-01 + docs P241-05; residual operational validation deferred in Plan 242 |
| C8RPF-29 | LOW / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-30 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-31 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-32 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-33 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-34 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-35 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-36 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-37 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-38 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-39 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-40 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-41 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-42 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-43 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-44 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-45 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-46 | MEDIUM / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-47 | HIGH / HIGH | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-48 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-49 | LOW / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-50 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |
| C8RPF-51 | MEDIUM / MEDIUM | Deferred in `plan/plan-242-cycle8-rpf-deferred.md` |

## Implementation tasks

### P241-01 — Pin rate-limit windows and correct trusted proxy IP selection
- **Findings:** C8RPF-01, C8RPF-02, C8RPF-28 partial.
- **Files:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, targeted tests/docs.
- **Plan:** Compute bucket starts once per login/password/user-create/share flow and pass them through increment/check/reset/decrement/rollback. Fix `getClientIp()` to select the untrusted client immediately before the trusted proxy suffix and document/test the multi-hop behavior.
- **Acceptance:** unit tests cover `TRUSTED_PROXY_HOPS=2`, too-short forwarded chains, and rollback helpers passing pinned bucket starts; lint/typecheck/tests pass.
- **Status:** done.

### P241-02 — Harden upload/delete/restore mutation boundaries
- **Findings:** C8RPF-03, C8RPF-04, C8RPF-05, C8RPF-06, C8RPF-07.
- **Files:** `apps/web/src/app/actions/images.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `admin-users.ts`, `tags.ts`, `topics.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, new/shared lock utility if needed, tests/messages.
- **Plan:** Sanitize/bound `user_filename` before file I/O. Re-check restore maintenance immediately before upload DB insert and hoist maintenance guards near the top of mutating actions. Serialize uploads and upload-processing contract changes with a shared lock/critical section so `image_sizes` / `strip_gps_on_upload` cannot race the first insert. Improve deletion cleanup handling with retry/partial-failure signaling for leftover public artifacts.
- **Acceptance:** targeted tests cover invalid upload filenames, upload/settings race guard behavior where practical, and existing delete UI still warns on cleanup failures; full gates pass.
- **Status:** done.

### P241-03 — Align cache/edge/OG/performance low-risk runtime contracts
- **Findings:** C8RPF-08, C8RPF-09, C8RPF-15, C8RPF-16, C8RPF-17, C8RPF-18.
- **Files:** shared route pages, `apps/web/nginx/default.conf`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/process-image.ts`, tests/docs.
- **Plan:** Add explicit `revalidate = 0` to shared routes, remove PNG from the nginx upload regex, resolve OG topic labels from canonical topic data and mark generated OG responses non-store, switch the photo viewer away from synchronous image decode, and size Sharp workers via effective available parallelism.
- **Acceptance:** tests/gates pass; no route API compatibility changes except stricter edge allowlist and fresher OG/shared behavior.
- **Status:** done.

### P241-04 — Fix bounded UI/UX and CSP issues
- **Findings:** C8RPF-10, C8RPF-11, C8RPF-12, C8RPF-13, C8RPF-14.
- **Files:** `login-form.tsx`, `password-client.tsx`, `info-bottom-sheet.tsx`, `photo-viewer.tsx`, shared group route(s), `dashboard-client.tsx`, `image-manager.tsx`, `layout.tsx`, tests if existing contracts need update.
- **Plan:** Render semantic H1s on auth/password pages, autofocus the mobile info sheet focus trap, add a `PhotoViewer` prop to suppress its hidden H1 when a parent route provides one, contain mobile dashboard table overflow, and pass the CSP nonce to `ThemeProvider`.
- **Acceptance:** lint/typecheck/build pass; browser-observed issues have code-level fixes.
- **Status:** done.

### P241-05 — Synchronize docs and config examples with runtime behavior
- **Findings:** C8RPF-19, C8RPF-20, C8RPF-21, C8RPF-22, C8RPF-23, C8RPF-24, C8RPF-28 partial.
- **Files:** `README.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `CLAUDE.md`, maybe `apps/web/src/site-config.json` if it contains stale unused fields.
- **Plan:** Clarify DB-vs-file site-config split; remove or mark `parent_url` as unsupported; document `IMAGE_BASE_URL` URL-shape constraints; call out production `BASE_URL`/non-placeholder site URL requirement; document same-origin fail-closed behavior when `Origin`/`Referer` are absent; align action-origin exemption wording with scanner behavior.
- **Acceptance:** docs no longer contradict runtime behavior; no product feature is advertised without code support.
- **Status:** done.

### P241-06 — Quality gates and progress accounting
- **Findings:** all scheduled tasks.
- **Files:** this plan plus any touched tests.
- **Plan:** Update task statuses during implementation. Run all configured gates across the whole repo: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`. Fix blocking errors before committing/pushing.
- **Acceptance:** gates green or any non-blocking warnings preserved in deferred plan with severity/exit criteria.
- **Status:** done — `npm run lint`, `npm run typecheck`, `npm run lint:api-auth`, `npm run lint:action-origin`, `npm test` (372/372), and `npm run build` all green for cycle 1 finalization.

## Progress / verification
- Prompt 2: plan created.
- Prompt 3: scheduled code/docs/test fixes implemented; whole-repo gates green; commits pushed.
