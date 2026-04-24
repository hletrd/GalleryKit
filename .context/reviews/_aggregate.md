# Aggregate Review — Cycle 1 / Prompt 1

Date: 2026-04-24
Repo: `/Users/hletrd/flash-shared/gallery`

## Agent roster and provenance

Executed review lanes:
- `code-reviewer` → `.context/reviews/code-reviewer.md`
- `security-reviewer` → `.context/reviews/security-reviewer.md`
- `critic` → `.context/reviews/critic.md`
- `verifier` → `.context/reviews/verifier.md`
- `test-engineer` → `.context/reviews/test-engineer.md`
- `architect` → `.context/reviews/architect.md` (initial spawn failed from child-agent limit; retried successfully)
- `debugger` → `.context/reviews/debugger.md`
- `designer` → `.context/reviews/designer.md`
- `perf-reviewer` → `.context/reviews/perf-reviewer.md` (default-role specialist prompt)
- `tracer` → `.context/reviews/tracer.md` (default-role specialist prompt)
- `document-specialist` → `.context/reviews/document-specialist.md` (default-role specialist prompt)
- `product-marketer-reviewer` → `.context/reviews/product-marketer-reviewer.md` (custom reviewer-style prompt)

Workspace protocol capped concurrent child agents at 5 usable spawned lanes here, so the fan-out ran in waves. All requested available reviewer perspectives returned or were retried once.

## AGENT FAILURES

- `architect`: first spawn attempt failed with `agent thread limit reached`; retried once and returned a complete review. No final missing review lane.

## Consolidated finding count

**NEW_FINDINGS: 54** deduped findings.

Cross-agent agreement increased priority for:
- sitemap dynamic/cache/lastModified/size semantics (`code-reviewer`, `critic`, `perf-reviewer`, `document-specialist`)
- missing `site-config.json` in CI/fresh checkout (`verifier`, `tracer`, product/docs reviewers)
- host-network/Docker/nginx deployment mismatch (`critic`, `tracer`, `document-specialist`, `product-marketer-reviewer`)
- restore maintenance process-local semantics (`architect`, `critic`, `tracer`)
- settings/SEO blank-editor failure state (`critic`, `designer`)
- storage abstraction/local-only messaging (`architect`, `document-specialist`, `product-marketer-reviewer`)

## Deduped findings

### A. Correctness / security / build blockers
1. **Fresh checkout / CI build lacks required ignored `src/site-config.json`** — High/High. Sources: verifier, tracer. Files: `.github/workflows/quality.yml`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/site-config.example.json`.
2. **Precomputed Argon2 admin bootstrap hashes are documented but automatic migration hashes the hash string** — High/High. Source: document-specialist. File: `apps/web/scripts/migrate.js`.
3. **Admin API unauthenticated 401 lacks no-store headers** — Medium/High. Source: debugger. Files: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
4. **Admin API origin invariant is not centralized/linted for future mutating routes** — Medium/High. Source: architect. Files: `apps/web/src/lib/api-auth.ts`, `apps/web/scripts/check-api-auth.ts`.
5. **Origin-guard E2E can pass on auth failure without proving same-origin enforcement** — High/High. Source: test-engineer. File: `apps/web/e2e/origin-guard.spec.ts`.
6. **Typecheck includes volatile `.next/dev/types` artifacts** — Medium/High. Source: architect. File: `apps/web/tsconfig.json`.
7. **E2E seed loads `.env.local` after importing env-dependent upload paths / image sizes** — Low/High. Source: verifier. File: `apps/web/scripts/seed-e2e.ts`.
8. **Local workspace env files contain live plaintext secrets** — High/High. Source: security-reviewer. Files: `apps/web/.env.local`, `.env.deploy` (gitignored/untracked; operational rotation required).
9. **Production CSP permits inline scripts/styles** — Medium/Medium. Source: security-reviewer. File: `apps/web/next.config.ts`.
10. **Login/password DB-backed rate limit checks can overrun under distributed bursts** — Medium/High. Source: tracer. File: `apps/web/src/app/actions/auth.ts`.
11. **`createTopic` can leave topic image files behind when route conflict returns early** — Low/High. Source: tracer. File: `apps/web/src/app/actions/topics.ts`.

### B. SEO / metadata / sitemap / marketing correctness
12. **Sitemap is forced dynamic while claiming daily revalidation** — Medium/High. Sources: critic, perf-reviewer, document-specialist. File: `apps/web/src/app/sitemap.ts`.
13. **Sitemap emits request-time `lastModified` for unchanged pages** — Medium/High. Sources: code-reviewer, critic. File: `apps/web/src/app/sitemap.ts`.
14. **Sitemap silently truncates beyond 24,000 images before locale expansion** — Medium/High. Source: code-reviewer. File: `apps/web/src/app/sitemap.ts`.
15. **Custom OG image does not propagate to Twitter images on home/topic pages** — Medium/High. Source: critic. Files: public home/topic pages.
16. **Filtered home/topic SEO policy is inconsistent** — Medium/Medium. Source: critic. Files: public home/topic metadata.
17. **Localized OG metadata uses one configured locale for all localized routes** — Medium/Medium. Source: product-marketer-reviewer. Files: public metadata config.
18. **Photo JSON-LD hardcodes Creative Commons license that admins cannot configure** — Medium/Medium. Source: product-marketer-reviewer. File: photo page metadata/JSON-LD.
19. **Homepage social preview can silently use latest uploaded photo as site-wide OG image** — Medium/Medium. Source: product-marketer-reviewer. File: home metadata.
20. **“Download original” review finding: current user-facing copy says JPEG, but key/name still implies original** — High/High originally, currently partially fixed. Source: code-reviewer. File: `apps/web/src/components/photo-viewer.tsx`, messages.

### C. Deployment / documentation mismatches
21. **Top-level Docker-ready/single-command claim overpromises host-network deployment constraints** — Medium/High. Sources: critic, product-marketer-reviewer.
22. **Shipped nginx upload `root` does not match documented host-network host-nginx deployment** — High/Medium-High. Sources: tracer, document-specialist.
23. **First-run onboarding skips database initialization/admin bootstrap/site-config steps** — High/High. Source: product-marketer-reviewer.
24. **`UPLOAD_MAX_FILES_PER_WINDOW` is documented but hard-coded** — Medium/High. Source: document-specialist.
25. **DB security docs overstate “all queries via Drizzle”** — Medium/High. Source: document-specialist.
26. **`SHARP_CONCURRENCY` default comment is off by one CPU** — Low/High. Source: document-specialist.
27. **Remote admin Playwright docs omit `E2E_ADMIN_ENABLED=true`** — Low/High. Source: document-specialist.
28. **`CLAUDE.md` describes `src/app/actions.ts` as implementation file instead of barrel** — Low/High. Source: document-specialist.
29. **Cache comments are contradictory/deliberative** — Low/Medium. Source: document-specialist.
30. **Storage comments advertise S3/MinIO semantics despite local-only contract** — Low/High. Sources: document-specialist, product-marketer-reviewer.
31. **Generic positioning does not define a beachhead user** — Low/Medium. Source: product-marketer-reviewer.
32. **Batch-editing claim exceeds shipped admin edit surface** — Medium/Medium. Source: product-marketer-reviewer.
33. **GPS/location messaging is privacy-ambiguous** — Medium/Medium. Source: product-marketer-reviewer.
34. **Public footer hardcodes GitHub/admin links, reducing white-label polish** — Low/Medium. Source: product-marketer-reviewer.
35. **Korean localization has structurally complete strings but EXIF values remain English** — Low/Medium. Source: product-marketer-reviewer.

### D. UI / accessibility / UX
36. **Footer admin link contrast is below WCAG at rest** — Medium/High. Source: designer. File: `apps/web/src/components/footer.tsx`.
37. **Tag picker lacks `aria-activedescendant` / stable option IDs** — High/High. Source: designer. File: `apps/web/src/components/tag-input.tsx`.
38. **Search results mix listbox and link semantics** — Medium/Medium. Source: designer. File: `apps/web/src/components/search.tsx`.
39. **Password confirmation error is not field-linked** — Medium/High. Source: designer. File: password form.
40. **Settings/SEO pages fall back to blank editors on fetch failure** — Medium/Medium. Sources: critic, designer. Files: settings/seo pages.
41. **Infinite scroll lacks explicit manual keyboard/fallback trigger** — Medium/Medium. Source: designer. File: `apps/web/src/components/load-more.tsx`.
42. **Info bottom sheet opens expanded instead of intended peek state** — Medium/High. Source: debugger. File: `apps/web/src/components/info-bottom-sheet.tsx`.

### E. Performance / scaling / architecture
43. **Image-processing work can multiply CPU/memory concurrency per queue slot** — High/High. Source: perf-reviewer.
44. **Queue bootstrap loads/enqueues every pending image at once** — Medium/High. Sources: perf-reviewer, architect.
45. **Queue bootstrap does not retry after startup DB failure** — Medium-High/High. Source: architect.
46. **Public gallery first pages compute exact total count on hot path** — Medium/High. Source: perf-reviewer.
47. **Single/bulk deletes can rescan derivative directories once per image/format** — Medium/High. Source: perf-reviewer.
48. **Admin CSV export materializes large DB result/CSV through a server action** — Medium/High. Sources: perf-reviewer, debugger.
49. **Public search uses leading-wildcard LIKE over multiple fields/joins** — Medium/Medium. Source: perf-reviewer.
50. **Rate-limit purge lacks a supporting leftmost index on `bucket_start`** — Medium/Medium. Source: perf-reviewer.
51. **Some mutations perform both narrow and broad revalidation** — Low/Medium. Source: perf-reviewer.
52. **Optional heavy photo-viewer UI loads into initial chunk** — Low/Medium. Source: perf-reviewer.
53. **Mobile photo swipe updates React state on every touchmove** — Low/Medium. Source: perf-reviewer.
54. **Core data/actions/UI files are broad monolith clusters / storage abstraction dead code** — Medium/High. Sources: architect, code-reviewer.

### F. Test gaps
The test-engineer lane reported 11 coverage gaps. They map to the implementation items above and to deferred future coverage for visual regression, settings persistence, action guard integration, sharing actions, backup/restore process failure, admin delete concurrency, image processing helpers, search stale-response/keyboard behavior, and performance regression locking.
