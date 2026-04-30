# Plan 02: P0 Quick Fixes (COMPLETED)

**Status:** DONE  
**Deployed:** 2026-04-12  
**Commits:** `706fa0a`, `fd8c7f8`, `0b1bf8e`, `95a6944`

## Completed Items
- [x] Client-side password minLength 8→12 (password-form.tsx, admin-user-manager.tsx)
- [x] Migration script password minimum 8→12 (migrate.js)
- [x] Visible "Minimum 12 characters" hint near password fields
- [x] user_filename removed from public selectFields (data.ts)
- [x] GPS latitude validation capped at 90° (process-image.ts)
- [x] GA ID validated with regex + JSON.stringify before interpolation (layout.tsx)
- [x] Runtime deps moved from devDependencies to dependencies (7 packages)
- [x] Error boundaries added (global-error.tsx, [locale]/error.tsx)
- [x] GPS float→double in migration SQL
