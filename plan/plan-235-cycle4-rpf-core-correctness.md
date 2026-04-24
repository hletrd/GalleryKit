# Plan 235 — Cycle 4 RPF core correctness/security/SEO fixes
Status: complete

## Repo rules read before planning
- `CLAUDE.md` — Node 24+, Next.js 16 app router, local-only storage support, single web-instance topology, security lint gates, no supported S3/MinIO switching, commit/push with gitmoji from AGENTS.
- `AGENTS.md` — always commit/push changes and use gitmoji.
- `.context/**` / existing `plan/**` — prior deferrals for CSP, CSV streaming, persistent processing state, distributed coordination, storage abstraction, and visual/testing expansion were noted; current non-deferred correctness/security findings below remain scheduled.
- No `CONTRIBUTING.md` or `.cursorrules` exists.

## Implementation tasks

### P235-01 — Align backup generation with restore scanner
- **Findings:** AGG-C4-004 (`db-actions.ts:136-143,367-381`; `sql-restore-scan.ts:17-19`) HIGH/Medium-High; duplicate CR-C4-01/TR-C4-03.
- **Plan:** Make app-generated dumps acceptable to the restore scanner without allowing arbitrary destructive SQL. Add a dump/scan regression fixture for the exact statement profile.
- **Acceptance:** Unit tests cover app-generated dump statements; restore scanner remains blocking privileged/destructive non-backup SQL.
- **Status:** done

### P235-02 — Surface or fail upload tag persistence errors
- **Findings:** AGG-C4-005 (`actions/images.ts:252-287,305-343`) MEDIUM/High.
- **Plan:** Treat tag persistence as part of upload success or return a durable per-file warning/error; add a regression around tag failure behavior.
- **Acceptance:** Upload no longer silently reports clean success when requested tags fail.
- **Status:** done

### P235-03 — Fix trusted-proxy cookie/security parsing and action scanner extension coverage
- **Findings:** AGG-C4-013 (`actions/auth.ts:206-214`) MEDIUM/High; AGG-C4-014 (`scripts/check-action-origin.ts:49-68`) LOW-MEDIUM/Medium; AGG-C4-063 README proxy docs LOW/High.
- **Plan:** Reuse trusted-proxy/right-most forwarded proto parsing for login cookie Secure decisions; scan `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts` server action files or document/enforce narrower policy; clarify README proxy language.
- **Acceptance:** Regression tests cover multi-hop forwarded proto and scanner extension discovery/exclusion.
- **Status:** done

### P235-04 — Remove production inline-script CSP weakness with nonces
- **Findings:** AGG-C4-003 (`next.config.ts:73-76`) MEDIUM/High security.
- **Plan:** Move production page CSP to nonce-bearing middleware/proxy response headers, remove static production `script-src 'unsafe-inline'`, pass/read nonces for app inline JSON-LD and GA scripts, keep dev compatibility.
- **Acceptance:** Build/e2e pass; production CSP header no longer contains `script-src 'unsafe-inline'`.
- **Status:** done

### P235-05 — Fix SEO/social metadata consistency
- **Findings:** AGG-C4-007, 008, 009, 010, 048, 049, 050, 051 (`api/og/route.tsx`, shared pages, public pages, `photo-title.ts`, `robots.ts`, SEO copy) HIGH/MEDIUM.
- **Plan:** Reuse runtime SEO settings in OG generation where possible; align shared photo/group metadata with rendered selected photo; normalize gallery card/JSON-LD titles; remove unconfigured CC license claim; align robots and helper copy with supported share/social behavior.
- **Acceptance:** Metadata helpers/tests prove visible titles and social/JSON-LD titles match normalized rules; robots no longer contradicts share preview intent.
- **Status:** done

### P235-06 — Bound sitemap size and request-time work
- **Findings:** AGG-C4-020/039 (`sitemap.ts:15-54`; `data.ts:202-204`) MEDIUM/High.
- **Plan:** Reserve URL budget for topics/images per locale and cache/revalidate sitemap generation where safe.
- **Acceptance:** Sitemap remains under 50,000 URLs at max images/topics and has regression coverage.
- **Status:** done

### P235-07 — Tighten site/env/deployment documentation and validation
- **Findings:** AGG-C4-002, 016, 017, 030, 032, 033, 034, 035, 036 (`nginx/default.conf`, `site-config.json`, `ensure-site-config.mjs`, package docs/env docs) HIGH/MEDIUM.
- **Plan:** Add production placeholder-origin validation, document config authority boundaries, queue/sharp concurrency and DB TLS behavior, correct TypeScript support badge/constraint if needed, and make nginx docs/config explicit about TLS edge assumptions.
- **Acceptance:** `npm run build` fails for production placeholder site URL unless env override is present; docs/env examples match real knobs.
- **Status:** done

### P235-08 — Fix stale revalidation after upload/process/share/delete/settings mutations
- **Findings:** AGG-C4-043, 044, 045, 046, 047 (`actions/images.ts`, `image-queue.ts`, `actions/seo.ts`, `revalidation.ts`, `settings.ts`) HIGH/MEDIUM.
- **Plan:** Revalidate public surfaces after processing completes, invalidate share pages on metadata edits, include adjacent photo routes after deletes where possible, remove redundant path+layout invalidations, and lock settings changes against concurrent upload start.
- **Acceptance:** Regression tests or focused code assertions cover the revalidation paths; no redundant invalidation remains where layout invalidation supersedes path invalidation.
- **Status:** done

### P235-09 — Local secret checkout cleanup
- **Findings:** AGG-C4-001 (`apps/web/.env.local:2-9`) HIGH/High.
- **Plan:** Move local live `.env.local` out of the repo checkout (not committed), leave only the tracked `.env.local.example` with placeholders, and document that secrets must be injected outside shared checkouts.
- **Acceptance:** `apps/web/.env.local` no longer exists inside the repo path after the cycle; no secret values are committed.
- **Status:** done

## Gates
Run the full cycle gates after implementation: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`.


## Progress / verification
- Completed in cycle 4.
- Gates run green after implementation: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` (58 files / 341 tests), and `E2E_ENV_FILE=$HOME/.gallerykit-secrets/gallery-web.env.local.cycle4 npm run test:e2e` (20 Playwright tests).
- Local `apps/web/.env.local` was moved outside the repo checkout to `$HOME/.gallerykit-secrets/gallery-web.env.local.cycle4`; no secret values were committed.
