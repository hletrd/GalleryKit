# Cycle 4 Review Aggregate — PROMPT 1

## Agent roster and provenance
Per-agent review files retained under `.context/reviews/`:
- `code-reviewer.md`, `security-reviewer.md`, `critic.md`, `verifier.md`, `test-engineer.md`, `architect.md`, `debugger.md`, `designer.md`, `dependency-expert.md`, `document-specialist.md`, `perf-reviewer.md`, `tracer.md`, `product-marketer-reviewer.md`, `ui-ux-designer-reviewer.md`.

Write-blocked lanes were preserved manually from their returned markdown (`code-reviewer`, `security-reviewer`, `architect`). No agent failed after retry. UI/browser lanes documented that the public gallery was DB-blocked locally (`ECONNREFUSED 127.0.0.1:3306`) but admin login rendered.

## Dedupe rules
Duplicate findings are merged below with the highest severity/confidence preserved. Cross-agent agreement is noted in `Sources`. Items marked `already-covered/stale` were present in the review corpus but current source inspection showed the tree already has a fix or an existing carry-forward plan; they still remain listed so Prompt 2 can schedule, defer, or archive them explicitly.

## Merged findings

| ID | Severity | Confidence | Sources | Disposition hint | Finding |
|---|---|---:|---|---|---|
| AGG-C4-001 | HIGH | High | security-reviewer | operational | Ignored local `apps/web/.env.local` contains live DB/admin/session secrets inside the repo checkout. |
| AGG-C4-002 | HIGH | Medium | security-reviewer | implement/docs | `apps/web/nginx/default.conf` ships HTTP-only edge config with no HTTPS redirect/TLS enforcement. |
| AGG-C4-003 | MEDIUM | High | security-reviewer, prior deferred | deferred/large | Production CSP still uses `'unsafe-inline'`, weakening XSS containment. |
| AGG-C4-004 | HIGH | Medium-High | code-reviewer, tracer | implement | App-generated `mysqldump` backups can include statements (`DROP TABLE`) rejected by restore scanning. |
| AGG-C4-005 | MEDIUM | High | code-reviewer | implement | `uploadImages()` can ignore tag creation/linking failures while reporting upload success. |
| AGG-C4-006 | MEDIUM | High | code-reviewer, architect | deferred/large | Storage backend switching abstraction exists but live upload/process/serve paths bypass it. |
| AGG-C4-007 | MEDIUM | High | code-reviewer, architect, product-marketer | implement | Topic OG image route uses static `site-config.json` instead of runtime SEO branding. |
| AGG-C4-008 | MEDIUM | High | critic | implement | Shared photo metadata does not reuse normalized title/tag fallback used by rendered page. |
| AGG-C4-009 | MEDIUM | High | critic | implement | Shared group `?photoId=` deep links render a selected photo but metadata stays generic group metadata. |
| AGG-C4-010 | MEDIUM | High | critic | implement | Gallery card titles/ARIA/JSON-LD do not consistently use normalized photo-title rules. |
| AGG-C4-011 | LOW | High | critic, document-specialist | archive/docs | Historical review/plan artifacts read as unresolved after fixes. |
| AGG-C4-012 | HIGH | High | architect, critic, tracer | deferred/large | Correctness depends on process-local single-instance coordination not enforced in product. |
| AGG-C4-013 | MEDIUM | High | verifier | implement | Login cookie `Secure` decision parses forwarded proto differently than trusted-proxy helpers. |
| AGG-C4-014 | LOW-MEDIUM | Medium | verifier | implement | Action-origin scanner only discovers `.ts` action files. |
| AGG-C4-015 | HIGH | High | architect, test-engineer, prior deferred | deferred/large | Image-processing queue lacks durable failed-job/dead-letter state and admin recovery. |
| AGG-C4-016 | MEDIUM | High | architect | implement/docs | Config authority is split across JSON/env/DB/build-time settings with unclear boundaries. |
| AGG-C4-017 | MEDIUM | High | architect | implement | Production build can ship placeholder localhost site config. |
| AGG-C4-018 | MEDIUM | High | architect | deferred/product | All admins are root-equivalent; no capability boundaries. |
| AGG-C4-019 | MEDIUM | High | architect, designer | implement | Settings UI exposes write-once controls as normal editable controls after images exist. |
| AGG-C4-020 | MEDIUM | High | debugger | implement | Sitemap URL count can exceed 50k because topics are uncapped. |
| AGG-C4-021 | MEDIUM | High | designer, ui-ux | deferred/large | Public DB outage falls through to a generic error shell instead of a gallery-specific maintenance state. |
| AGG-C4-022 | MEDIUM | High | designer | implement | Search input removes visible focus indication. |
| AGG-C4-023 | LOW-MEDIUM | High | designer | implement | Search result/error/loading state changes are not announced via live region. |
| AGG-C4-024 | MEDIUM | High | designer | implement | Admin dashboard keeps upload and image manager side-by-side too early/cramped. |
| AGG-C4-025 | LOW-MEDIUM | Medium | designer | implement | Login failures are toast-only and not field-linked/inline. |
| AGG-C4-026 | LOW | High | designer, ui-ux | implement | Dialog/sheet close labels are hardcoded English. |
| AGG-C4-027 | LOW | High | designer, ui-ux | deferred/i18n | RTL is not prepared; root is locked `dir="ltr"` and physical layout is widespread. |
| AGG-C4-028 | LOW-MEDIUM | High | designer | implement | Photo-viewer keyboard shortcuts are hidden behind title/ARIA only. |
| AGG-C4-029 | LOW | High | designer, prior deferred | deferred/large | Blur placeholder is a transparent 1×1 placeholder rather than real blur/dominant color. |
| AGG-C4-030 | MEDIUM | High | dependency-expert | implement | TypeScript 6 is outside locked `typescript-eslint` peer support range. |
| AGG-C4-031 | LOW-MEDIUM | Medium | dependency-expert | defer/risk | `drizzle-kit` is pinned to prerelease beta line. |
| AGG-C4-032 | HIGH | High | dependency-expert, perf-reviewer | implement | Image processing/auth native work can oversubscribe CPU/libuv in containers. |
| AGG-C4-033 | MEDIUM | High | document-specialist, product-marketer | implement/docs | Settings docs/locale copy mention controls (upload limits/storage/concurrency) not present in live UI/schema. |
| AGG-C4-034 | MEDIUM | High | document-specialist | implement/docs | `QUEUE_CONCURRENCY` exists but is not documented in env/operator docs. |
| AGG-C4-035 | MEDIUM | High | document-specialist | implement/docs | `IMAGE_BASE_URL` docs omit enforced URL-shape constraints. |
| AGG-C4-036 | MEDIUM | High | document-specialist | implement/docs | Top-level docs omit default TLS behavior for non-local MySQL and `DB_SSL=false` opt-out. |
| AGG-C4-037 | MEDIUM | High | perf-reviewer | deferred/perf | Public listing query uses `COUNT(*) OVER()` on full matching set. |
| AGG-C4-038 | MEDIUM | High | perf-reviewer | deferred/perf | Public search uses leading-wildcard `LIKE` scans without a search-specific index. |
| AGG-C4-039 | MEDIUM | High | perf-reviewer, debugger | implement | Dynamic sitemap rebuilds large data on each bot request and needs split/cache/caps. |
| AGG-C4-040 | MEDIUM | High | perf-reviewer, ui-ux | implement | Upload preview creates/renders object URLs for every selected file without client caps/status. |
| AGG-C4-041 | MEDIUM | Medium-High | perf-reviewer, prior deferred | deferred/large | CSV export materializes rows, lines, string, server-action payload, and client Blob. |
| AGG-C4-042 | LOW-MEDIUM | High | perf-reviewer, ui-ux | implement | Admin mounts many `TagInput`s with repeated scans/listeners and weak contextual names. |
| AGG-C4-043 | LOW | High | perf-reviewer | implement | Mutations redundantly call broad layout and path-level revalidation. |
| AGG-C4-044 | HIGH | High | tracer | implement | Upload completion can leave public ISR caches stale before new image becomes `processed=true`. |
| AGG-C4-045 | MEDIUM | High | tracer | implement | Metadata edits do not invalidate direct-share/group-share pages. |
| AGG-C4-046 | MEDIUM | High | tracer | implement | Photo deletes miss adjacent photo navigation cache invalidation. |
| AGG-C4-047 | MEDIUM | Medium | tracer | implement | New-gallery settings/upload race can generate derivatives with stale image-size/GPS settings. |
| AGG-C4-048 | HIGH | High | product-marketer | implement | Public photo JSON-LD advertises every image as CC BY-NC without setting/docs. |
| AGG-C4-049 | MEDIUM | High | product-marketer | implement | SEO UI says photo/share pages use photo images but global OG image overrides them. |
| AGG-C4-050 | MEDIUM | Medium | product-marketer | implement/docs | Robots disallow share routes despite share pages emitting OG/Twitter preview metadata. |
| AGG-C4-051 | LOW | High | product-marketer | implement/copy | OG image URL help copy invites generic “Full URL” but validation accepts relative or same-origin only. |
| AGG-C4-052 | MEDIUM | High | ui-ux | implement | Mobile info sheet opens without moving focus/announcing dialog. |
| AGG-C4-053 | LOW | High | ui-ux | implement | Photo detail dynamic loading fallback is hardcoded English. |
| AGG-C4-054 | LOW | High | ui-ux | implement | Footer visible “Admin” label is untranslated. |
| AGG-C4-055 | MEDIUM | High | ui-ux | implement | Dialog/alert-dialog content lacks mobile max-height/scroll guard. |
| AGG-C4-056 | MEDIUM | Medium-High | ui-ux | implement | Switch primitive is below comfortable/mobile target size. |
| AGG-C4-057 | MEDIUM | High | ui-ux | implement | Batch upload failures are toast-level and lose per-file diagnosis. |
| AGG-C4-058 | MEDIUM | Medium-High | ui-ux | implement | Batch action toolbar scrolls away inside admin image manager. |
| AGG-C4-059 | LOW-MEDIUM | High | ui-ux | implement | Admin table checkboxes have tiny touch targets. |
| AGG-C4-060 | LOW | Medium-High | ui-ux | implement | Thumbnail alt text can become verbose captions/tag lists. |
| AGG-C4-061 | LOW-MEDIUM | Medium | ui-ux | implement | Locale-prefixed icon requests can hit the public topic route. |
| AGG-C4-062 | LOW-HIGH | High | test-engineer | deferred/tests | Broad coverage gaps remain for auth, sharing actions, image processing, settings behavior, startup/shutdown, visual assertions, flaky upload E2E, and coverage thresholds. |
| AGG-C4-063 | LOW | High | verifier | implement/docs | README overstates `TRUST_PROXY` dependency for same-origin checks. |

## Cross-agent agreement highlights
- **Highest agreement:** process-local/single-instance state, storage abstraction drift, SEO/OG metadata drift, sitemap scaling, and CPU oversubscription.
- **Highest immediate correctness/security signal:** backup/restore mismatch, forwarded-proto cookie parsing, upload tag partial success, stale revalidation for uploads/share/delete, sitemap 50k ceiling, and JSON-LD license claim.

## AGENT FAILURES
None after retry. Some lanes were write-blocked by role policy; their returned markdown was written into the requested per-agent files for provenance.
