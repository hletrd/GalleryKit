# Plan: Security Pass 1 (COMPLETED)

**Status:** DONE  
**Deployed:** 2026-04-11  
**Commits:** `2249daa`, `45845b3`, `eac0d99`, `ded5960`, `f9d80b3`

## Completed Items
- [x] Session cookie `Secure` flag tied to `X-Forwarded-Proto` (actions.ts)
- [x] SESSION_SECRET DB fallback refused in production (actions.ts)
- [x] Login timing equalized with dummy Argon2 hash (actions.ts)
- [x] Admin password minimum bumped 8→12 chars server-side (actions.ts)
- [x] DB restore serialized with process-level lock (db-actions.ts)
- [x] DB restore size cap aligned to 250MB body limit (db-actions.ts)
- [x] Dependencies bumped: next 16.2.3, react 19.2.5, drizzle-orm 0.45.2, mysql2 3.22, etc.
- [x] brace-expansion GHSA-f886-m6hf-6m8v audit fix
- [x] `.env.local` chmod 600 on local + prod
- [x] ESLint errors fixed (rules-of-hooks, set-state-in-effect)
