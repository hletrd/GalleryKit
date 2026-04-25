# Aggregate Review — Cycle 8 (Fresh, broad sweep, 2026-04-25)

**Cycle orchestrator:** review-plan-fix loop, cycle 8/100, broad-surface sweep.
**HEAD:** `0d3916b refactor(uploads): single-source tagsString split in uploadImages`.
**DEPLOY_MODE:** per-cycle.

## Source reviews (11 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle8-fresh.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle8-fresh.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle8-fresh.md` |
| Critic | `.context/reviews/critic-cycle8-fresh.md` |
| Verifier | `.context/reviews/verifier-cycle8-fresh.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle8-fresh.md` |
| Tracer | `.context/reviews/tracer-cycle8-fresh.md` |
| Architect | `.context/reviews/architect-cycle8-fresh.md` |
| Debugger | `.context/reviews/debugger-cycle8-fresh.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle8-fresh.md` |
| Designer | `.context/reviews/designer-cycle8-fresh.md` |

## Environment note on agent fan-out

Same as cycle-5/6/7 RPL: the Task/Agent fan-out tool is not exposed as a
named invocable primitive in this environment. Per the orchestrator's
"skip any not registered" clause, each reviewer role's scan was
performed directly and one file per role written to preserve provenance.
No reviewer role was silently dropped.

## Deduplicated findings

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG8F-01** | CR8F-01, P8F-01, S8F-03 (perf lens), Tracer Trace 2 | `/api/og` returns `Cache-Control: 'no-store, no-cache, must-revalidate'` on success and has no rate limit. Public unauthenticated CPU-bound endpoint amplifies social-share crawler load and is the only such surface without a rate-limit budget. | **MEDIUM** | High | **4 agents** |
| **AGG8F-02** | CR8F-02, P8F-02, Critic CR-CRIT-02 | `app/sitemap.ts` exports both `dynamic = 'force-dynamic'` and `revalidate = 3600`. force-dynamic overrides revalidate; the latter is dead code. Misleads operators and pegs the DB on aggressive crawler hits. | MEDIUM | High | 3 agents |
| **AGG8F-03** | CR8F-03 | `app/global-error.tsx` (`'use client'`) imports the entire `site-config.json`, shipping all SEO defaults to every browser. Only `nav_title` and `title` are used. | LOW | Medium | 1 agent |
| **AGG8F-04** | CR8F-04, V8F-10, T8F-06 | `audit-log` metadata silently truncates to a 4096-char `{truncated, preview}` shape; `uploadImages` and `deleteImages` can produce metadata that hits this cap. No test asserts on the truncation. | LOW | Medium | 3 agents |
| **AGG8F-05** | CR8F-05, S8F-02, V8F-11, DS8F-03 | `Permissions-Policy` header is `camera=(), microphone=(), geolocation=()`; missing modern privacy directives (`interest-cohort=()`, `browsing-topics=()`, `attribution-reporting=()`). Both Next config and nginx config affected. | LOW | Medium | 4 agents |
| **AGG8F-06** | CR8F-06, V8F-07 | `images.view_count` is signed `int` (max 2.1B). Theoretical overflow on a viral group share. Personal-gallery scope makes this LOW. | LOW | Low | 2 agents |
| **AGG8F-07** | CR8F-07 | `adminUsers.created_at` lacks `.notNull()` while every other timestamp has it. Cosmetic schema asymmetry. | LOW | Low | 1 agent |
| **AGG8F-08** | CR8F-08 | `global-error.tsx` calls `resolveErrorShellBrand(document, ...)` without try/catch in a fatal-error code path. | LOW | Low | 1 agent |
| **AGG8F-09** | S8F-01 | Audit-log upload/delete metadata could include sanitized `user_filename` of failed entries to aid post-mortems. Hardening, not vulnerability. | LOW | Medium | 1 agent |
| **AGG8F-10** | S8F-04 | `process-image.ts` ALLOWED_EXTENSIONS includes `.gif/.bmp` for originals; `serve-upload.ts` only serves `.jpg/.jpeg/.webp/.avif` derivatives. Asymmetry confuses policy. | LOW | Medium | 1 agent |
| **AGG8F-11** | S8F-05 | `Dockerfile` `npm ci` runs postinstall scripts on prod-deps stage. Could `--ignore-scripts` and `npm rebuild sharp argon2` for supply-chain hardening. | LOW | Medium | 1 agent |
| **AGG8F-12** | S8F-06 | `instrumentation.ts` shutdown does not flag `state.shuttingDown` to mutating server actions during the 15s drain window. | LOW | Low | 1 agent |
| **AGG8F-13** | S8F-07 | `verifySessionToken` uses React `cache()`, which could memoize stale state if `getCurrentUser` is called after `updatePassword` in the same request. Speculative; depends on future refactor. | LOW | Low | 1 agent |
| **AGG8F-14** | S8F-08 | `nginx/default.conf` declares `Permissions-Policy` in two places — defense-in-depth but maintenance hazard. | LOW | Medium | 1 agent |
| **AGG8F-15** | P8F-03 | `getImagesLitePage` uses `COUNT(*) OVER()` window function. Could parallelize via `getImagesLite` + `getImageCount` for large galleries. | LOW | Medium | 1 agent |
| **AGG8F-16** | P8F-04 | Hourly `gcInterval` runs three DELETEs sequentially. Could parallelize via `Promise.all`. Micro-optimization. | LOW | Low | 1 agent |
| **AGG8F-17** | P8F-05 | `loadMoreImages` re-throws DB errors instead of returning a structured error variant. Asymmetric vs `searchImagesAction`. | LOW | Medium | 1 agent |
| **AGG8F-18** | P8F-07 | `BASE_FLUSH_INTERVAL_MS = 5_000` means buffered view-count flush rarely coalesces under sustained traffic. Could increase to 15s + add max-buffer trigger. | LOW | Low | 1 agent |
| **AGG8F-19** | P8F-08, DSGN8F-05 | Public pages emit JSON-LD `<script>` even on `noindex` filtered views (`?tags=...`). Wasted payload. | LOW | Medium | 2 agents |
| **AGG8F-20** | A8F-01 | Public-route cache policy is inconsistent across surfaces: `revalidate=0`, `Cache-Control: no-store`, `force-dynamic`. No documented decision matrix. | LOW | Medium | 1 agent |
| **AGG8F-21** | A8F-02 | Six in-memory rate-limit Maps share a pattern but each has its own prune/rollback helpers. Compression possible (factory). DEFER. | LOW | Medium | 1 agent |
| **AGG8F-22** | A8F-03 | No lint rule enforces rate-limit on public `/api/*` routes. Companion to `lint:api-auth`. | LOW | Medium | 1 agent |
| **AGG8F-23** | A8F-04, DS8F-01 | Five env knobs are runtime-active but absent from `.env.local.example` (`AUDIT_LOG_RETENTION_DAYS`, `IMAGE_MAX_INPUT_PIXELS`, `IMAGE_MAX_INPUT_PIXELS_TOPIC`, `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`). | LOW | High | 2 agents |
| **AGG8F-24** | A8F-05 | Single-process runtime invariant is doc-only; no startup assertion. | LOW | Low | 1 agent |
| **AGG8F-25** | T8F-02 | No CI lint rule for contradictory route config exports (e.g., `force-dynamic` + `revalidate`). | LOW | Medium | 1 agent |
| **AGG8F-26** | T8F-03 | No vitest unit test for `safe-json-ld.ts` (XSS-relevant helper). | LOW | High | 1 agent |
| **AGG8F-27** | DS8F-02 | CLAUDE.md image-pipeline section omits `IMAGE_MAX_INPUT_PIXELS_TOPIC` separate cap. | LOW | High | 1 agent |
| **AGG8F-28** | DS8F-05 | `.context/` tracking convention undocumented in CLAUDE.md repo structure. | LOW | Medium | 1 agent |
| **AGG8F-29** | D8F-06 | Pre-cycle-5 rows in DB may carry Unicode-formatting characters in title/description/label/alias/tag/SEO that the new write-path validators reject. No data migration. | LOW | Medium | 1 agent |
| **AGG8F-30** | DSGN8F-01 | `global-error.tsx` brand title applies `uppercase tracking-[0.2em]` indiscriminately; renders awkwardly for Korean. | LOW | Medium | 1 agent |
| **AGG8F-31** | DSGN8F-03 | `/api/og` does not bundle a custom font. Relies on platform sans-serif. | LOW | Medium | 1 agent |
| **AGG8F-32** | DSGN8F-04 | `/api/og` topic label cap of 100 chars at 80px font can overflow for CJK languages. | LOW | Medium | 1 agent |
| **AGG8F-33** | Critic CR-CRIT-04 | `AUDIT_LOG_RETENTION_DAYS` default 90 days; OWASP guidance for admin-action logs is 1 year. Configurable but undocumented as a posture knob. | LOW | Medium | 1 agent |
| **AGG8F-34** | Critic CR-CRIT-05 | `check-action-origin.ts` lint relies on leading-comment match for `@action-origin-exempt`; a future formatter could reflow the comment. | LOW | Low | 1 agent |
| **AGG8F-35** | Critic CR-CRIT-06 | Multi-cycle deferred backlog (BMP/GIF asymmetry, photo-page ISR, search sequential, CSP nonce, etc.) deserves a triage pass: explicit WONTFIX or scheduled, not silently lingering. | LOW | High | 1 agent |

## Carry-forward

All previously-deferred items in `plan/plan-220-cycle6-rpl-deferred.md`, `plan-218-cycle5-rpl-deferred.md`, and earlier remain deferred. None re-opened by this sweep — but AGG8F-35 calls for a triage of the older backlog.

## Severity distribution

- HIGH: 0
- MEDIUM: 2 (AGG8F-01 OG cache+rate-limit, AGG8F-02 sitemap config)
- LOW: 33

## Cross-agent agreement highlights

- **AGG8F-01** (`/api/og` cache + rate-limit): 4 agents (code-reviewer, perf, security, tracer)
- **AGG8F-02** (sitemap force-dynamic + revalidate): 3 agents (code-reviewer, perf, critic)
- **AGG8F-04** (audit-log truncation): 3 agents (code-reviewer, verifier, test-engineer)
- **AGG8F-05** (Permissions-Policy missing modern directives): 4 agents (code-reviewer, security, verifier, document-specialist)
- **AGG8F-19** (JSON-LD on noindex): 2 agents (perf, designer)
- **AGG8F-23** (.env.local.example drift): 2 agents (architect, document-specialist)

## Recommended cycle-8 implementation priorities

1. **AGG8F-01** — `/api/og` cache + rate-limit. MEDIUM. Cross-agent. Single focused fix in one route + one new rate-limit bucket.
2. **AGG8F-02** — Drop `force-dynamic` from `app/sitemap.ts` so the existing `revalidate = 3600` actually takes effect. MEDIUM, one-line change.
3. **AGG8F-05** — Append modern privacy directives to `Permissions-Policy` (Next config + nginx). LOW, but cross-agent and mechanical.
4. **AGG8F-23** — Document missing env knobs in `.env.local.example`.
5. **AGG8F-26** — Add vitest unit test for `safe-json-ld.ts`.
6. **AGG8F-19** — Skip JSON-LD on `noindex` page variants.

The remaining 28 LOW items are bundle-or-defer candidates. Critic's stance (CR-CRIT-01, CR-CRIT-06) of "let convergence land" applies — a single hygiene plan triaging the LOW backlog is more valuable than implementing each individually.

## Net cycle-8 stance

This is the first cycle where a fresh broad-surface review surfaces predominantly delivery, observability, and documentation drift items rather than security or correctness defects. The codebase has materially converged. The two MEDIUM items deserve fixes; the LOW items deserve triage rather than reflexive implementation.

## AGENT FAILURES

None — all 11 reviewer roles returned content.
