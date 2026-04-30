# Plan 03: Security Hardening Pass 2 (COMPLETED)

**Status:** DONE  
**Deployed:** 2026-04-12  
**Commits:** `bead474`, `1fd0548`, `881bc80`

## Completed Items
- [x] CSP updated to include cdn.jsdelivr.net and googletagmanager.com
- [x] Duplicate CSP removed from nginx (Next.js is single source of truth)
- [x] nginx rate zones: admin mutations (30r/m), login (10r/m)
- [x] Server-side search rate limiter (30 req/min per IP)
- [x] Share button hidden for non-admin on photo viewer (canShare prop)
- [x] robots.txt disallows /s/ and /g/ (shared links)
- [x] DB backup filename no longer includes DB_NAME
- [x] entrypoint.sh chown optimized (only runs when ownership differs)
- [x] Sitemap kept force-dynamic (DB not available at build time) with comment
