# Aggregate Review — Cycle 1 (2026-04-29)

Repo: `/Users/hletrd/flash-shared/gallery`

Reviewers completed: code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer. The environment only allowed five live child agents at a time, so the required fan-out was executed in continuations after the first batch completed; no reviewer was silently dropped.

## Finding summary

| ID | Severity / Confidence | Source(s) | Finding | Plan disposition |
| --- | --- | --- | --- | --- |
| AGG1-01 | High / High | critic C1-CRIT-01 | Photo prev/next navigation is wrong across `capture_date IS NULL` boundaries (`apps/web/src/lib/data.ts:655-718`). | Schedule |
| AGG1-02 | High / High | critic C1-CRIT-02, security SEC-C1-03, architect A1 | nginx/proxy config breaks or weakens trusted HTTPS/proxy-origin assumptions (`apps/web/nginx/default.conf:16-19`, `:57`, `:74`, `:89`, `:124`). | Schedule |
| AGG1-03 | High / High | critic C1-CRIT-03 | CI sets `BASE_URL=http://127.0.0.1:3100` while production prebuild rejects localhost (`.github/workflows/quality.yml:27-35`, `apps/web/scripts/ensure-site-config.mjs:13-37`). | Schedule |
| AGG1-04 | High / High | security SEC-C1-01 | Server Action body transport cap creates a large pre-auth body budget (`apps/web/next.config.ts:69-77`, nginx default `client_max_body_size 2G`). | Schedule edge mitigation; defer route-handler migration |
| AGG1-05 | High / High | designer DSGN-C1-01 | Light destructive button token fails WCAG AA contrast (`globals.css:36-37`, `button.tsx:13-14`). | Schedule |
| AGG1-06 | High / Medium-high | tracer T1 | Large backlog image-queue bootstrap can strand failed low-ID jobs (`image-queue.ts:407-443`, `:328-331`). | Schedule |
| AGG1-07 | Medium / High | code-reviewer M1 | Shared-group view counts increment for intra-share photo navigation (`g/[key]/page.tsx:99-107`, `data.ts:844-848`). | Schedule |
| AGG1-08 | Medium / Medium | code-reviewer M2 | File-serving routes validate one path but stream another raceable path (`serve-upload.ts:75-92`, backup download `route.ts:60-83`). | Schedule |
| AGG1-09 | Medium / High | code-reviewer M3 | Settings/SEO actions trust `Record<string,string>` at runtime and can throw on malformed payloads (`settings.ts:40-65`, `seo.ts:55-94`). | Schedule |
| AGG1-10 | Medium / High | code-reviewer M4 | `batchUpdateImageTags` assumes arrays; a string can be iterated as one-character tags (`tags.ts:338-408`). | Schedule |
| AGG1-11 | Medium / Medium-high | critic C1-CRIT-04 | Runtime sitemap DB errors can cache a homepage-only sitemap for the ISR window (`sitemap.ts:4-76`). | Defer |
| AGG1-12 | Medium / High | critic C1-CRIT-05, architect A6 | nginx admin mutation throttling omits `/admin/seo` and `/admin/settings` (`nginx/default.conf:77-90`). | Schedule |
| AGG1-13 | Medium / High | critic C1-CRIT-06 | Previous gate evidence logs were incomplete (`.context/gate-logs/*`). | Schedule by rerunning full gates |
| AGG1-14 | High / High | perf, cycle-2 deferred | First public listing page forces grouped count/window work on dynamic requests (`data.ts:547-562`). | Defer |
| AGG1-15 | Medium / High | perf | Tag count/list data recomputed per dynamic request (`data.ts:272-289`, public pages). | Defer |
| AGG1-16 | Medium / High | perf | Public search uses leading-wildcard LIKE scans (`data.ts:915-1004`). | Defer |
| AGG1-17 | Medium / Medium-high | perf | Upload action holds upload-processing advisory lock through slow file/Sharp/DB/tag work (`images.ts:171-430`). | Defer |
| AGG1-18 | Medium / Medium-high | perf | One image-processing job runs three Sharp format pipelines in parallel (`process-image.ts:408-478`). | Defer |
| AGG1-19 | Medium / High | perf | Bulk delete can perform hundreds of upload-directory scans (`images.ts:612-626`, `process-image.ts:181-203`). | Defer |
| AGG1-20 | Medium / High | perf | CSV export materializes up to 50k rows and the full CSV in memory (`db-actions.ts:54-118`). | Defer |
| AGG1-21 | Medium / High | security SEC-C1-02 | Public `/s/<key>` and `/g/<key>` share-key pages have no explicit rate limit (`s/[key]/page.tsx`, `g/[key]/page.tsx`). | Schedule |
| AGG1-22 | Low-Medium / High | critic C1-CRIT-07 | Checked-in `site-config.json` points at maintainer domain, risking wrong self-host canonical URLs. | Defer |
| AGG1-23 | Low / Medium | perf | Node upload-serving fallback does multiple filesystem resolution syscalls per request (`serve-upload.ts:69-95`). | Defer |
| AGG1-24 | Low / Medium | perf | Back-to-top scroll listener runs on every scroll event (`home-client.tsx:121-129`). | Defer |
| AGG1-25 | Low / High | security SEC-C1-04, docs | Deployment docs still encourage live env files inside repo checkout (`README.md`, `deploy.sh`, `scripts/deploy-remote.sh`). | Defer |
| AGG1-26 | Low / Medium-high | security SEC-C1-05 | Authenticated DB backup download route is not rate-limited (`api/admin/db/download/route.ts:13-93`, nginx lacks `/api/admin` limiter). | Schedule nginx limiter |
| AGG1-27 | Low / High | security SEC-C1-06 | `TRUST_PROXY` misconfiguration collapses rate limits into one shared `unknown` bucket (`rate-limit.ts:82-113`). | Defer |
| AGG1-28 | Low-Medium / High | verifier VER-C1-01 | Login per-account rate-limit is DB-backed only despite docs saying both buckets use bounded maps (`auth.ts:123-145`, `rate-limit.ts:36-72`). | Schedule |
| AGG1-29 | High / High | test-engineer TE-01 | TSX/client component behavior is mostly outside the unit gate (`vitest.config.ts:6-10`, components). | Defer |
| AGG1-30 | High / High | test-engineer TE-02 | Sharing server actions lack direct behavioral tests (`sharing.ts:92-391`). | Partially schedule tests for touched share race; defer broad suite |
| AGG1-31 | High / High | test-engineer TE-03 | Topic cover image processor lacks real image/filesystem tests (`process-topic-image.ts:42-105`). | Defer |
| AGG1-32 | Medium / High | test-engineer TE-04 | `nav-visual-check` captures screenshots without visual assertions (`nav-visual-check.spec.ts`). | Defer |
| AGG1-33 | Medium-High / High | test-engineer TE-05 | E2E bootstrap has no retry around transient DB startup/migration failures (`run-e2e-server.mjs:75-84`). | Defer |
| AGG1-34 | Medium / High | test-engineer TE-06 | E2E fixtures can leak uploaded images/sessions on failures (`e2e/helpers.ts`, `admin.spec.ts`). | Defer |
| AGG1-35 | Medium / High | test-engineer TE-07 | High-value tests inspect source text instead of behavior. | Defer |
| AGG1-36 | Medium / High | test-engineer TE-08 | Middleware/metadata/OG route behavior has thin route-level coverage. | Defer |
| AGG1-37 | Low-Medium / Medium | test-engineer TE-09 | Backup-download chmod test can be flaky across runners. | Defer |
| AGG1-38 | Low-Medium / High | test-engineer TE-10 | No coverage artifact/threshold gate. | Defer |
| AGG1-39 | Medium / High | tracer T2, debugger DBG-01 | Concurrent photo-share loser consumes share-create rate limit while returning the winner key (`sharing.ts:156-168`). | Schedule |
| AGG1-40 | Medium / High | tracer T3 | Deleting all images from a group share leaves a live empty share URL (`data.ts:801-848`, image delete actions). | Schedule |
| AGG1-41 | Low-Medium / High | tracer T4 | Upload tracker conflates quota usage with active upload claims (`upload-tracker-state.ts`, `images.ts`). | Defer |
| AGG1-42 | Medium / High | tracer T5 | Docker image relies on compose-mounted `public/`; standalone runner lacks static public assets (`Dockerfile`, compose). | Defer |
| AGG1-43 | Medium / High | debugger DBG-02 | Permanently bad image-processing jobs retry indefinitely with no persisted failed state (`image-queue.ts`). | Defer persisted schema; schedule bootstrap reset mitigation |
| AGG1-44 | Medium / High | debugger DBG-03 | Restore temp files can leak / raw 500 on unexpected post-upload FS errors (`db-actions.ts`). | Defer |
| AGG1-45 | Low / High | debugger DBG-04 | Drizzle config builds unclear DB URL when env vars are absent (`drizzle.config.ts`). | Defer |
| AGG1-46 | Medium-High / High | architect A2 | Runtime does not enforce documented single-writer/process-local topology. | Defer per documented topology |
| AGG1-47 | Medium-High / High | architect A3 | Backup/restore is SQL-only while gallery state includes filesystem assets. | Defer feature; docs already warn persistence |
| AGG1-48 | Medium / High | architect A4 | Storage abstraction has drifted from live private/public storage boundary. | Defer |
| AGG1-49 | Medium / High | architect A5 | Build-time/runtime asset-origin policy share mutable `IMAGE_BASE_URL`. | Defer |
| AGG1-50 | Low / Medium | architect A7 | Topic image resources can orphan on crash between file finalization and DB ownership. | Defer |
| AGG1-51 | High / High | document-specialist #1 | Docker docs imply runtime `BASE_URL` satisfies production build, but compose must pass it at build time. | Defer docs |
| AGG1-52 | Medium / High | document-specialist #2-7 | Deploy/docs omit or mismatch env file behavior, async processing, free-space precheck, locked settings, OG restrictions, migration-on-start. | Defer docs |
| AGG1-53 | Low / High | document-specialist #8-9 | Upload docs omit 200 MiB per-file cap; `session.ts` comment says dev-only instead of non-production. | Defer docs |
| AGG1-54 | Medium / High | designer DSGN-C1-02 | Public route errors remove the normal navigation shell (`error.tsx:15-37`). | Defer |
| AGG1-55 | Medium / High | designer DSGN-C1-03 | Settings/SEO forms bypass native validation UX (`settings-client.tsx`, `seo-client.tsx`). | Defer |
| AGG1-56 | Medium / Medium | designer DSGN-C1-04 | Admin navigation links are visually small tap targets (`admin-nav.tsx:26-44`). | Schedule |
| AGG1-57 | Medium / Medium | designer DSGN-C1-05 | Info bottom sheet uses modal trap in peek/collapsed states (`info-bottom-sheet.tsx`). | Defer |
| AGG1-58 | Low-Medium / Medium | designer DSGN-C1-06 | Photo swipe navigation listens on `window` instead of photo region (`photo-navigation.tsx:42-139`). | Defer |
| AGG1-59 | Low / Medium | designer DSGN-C1-07 | Search combobox ARIA state is inconsistent for no-result/loading states (`search.tsx`). | Defer |
| AGG1-60 | Low / High | designer DSGN-C1-08 | `dir="ltr"` is hard-coded, limiting future RTL locales (`layout.tsx:89-95`). | Defer |
| AGG1-61 | Medium / High | existing Plan 250 / code inspection | ICC `mluc` profile names decode as UTF-16LE instead of UTF-16BE and metadata strings are not DB-byte bounded (`process-image.ts:341-352`, `images.ts:310`). | Schedule |

## Cross-agent agreement

- **AGG1-02** has agreement from critic, security, and architect; nginx proxy/TLS header handling is high signal.
- **AGG1-12** has agreement from critic and architect; `/admin/seo` and `/admin/settings` are missing edge admin throttling.
- **AGG1-39** has agreement from tracer and debugger; concurrent photo-share losers should roll back rate-limit precharges.
- **AGG1-14/16/20** overlap with prior deferred performance plans, confirming they remain known performance debt rather than new correctness failures.

## Agent failures / caveats

- Initial attempts to spawn all reviewer roles at once hit the environment's live-agent cap. The missing roles were retried as continuation batches and all required reviewer perspectives eventually produced files.
- Some continuation agents committed their review artifacts despite being asked not to commit during Prompt 1. The cycle implementation step will keep/push those commits and include them in the final commit count rather than rewriting history.
