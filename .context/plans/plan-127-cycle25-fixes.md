# Plan 127 — Cycle 25 Fixes (C25-09, C25-10, C25-11)

**Created:** 2026-04-19 (Cycle 25)
**Status:** DONE
**Severity:** 3 MEDIUM

---

## Problem

Three MEDIUM-severity issues identified in the cycle 25 comprehensive review:

1. **C25-09**: `dumpDatabase` and `restoreDatabase` in `db-actions.ts` pass `-u${DB_USER}` as a CLI argument to `mysqldump`/`mysql`, exposing the MySQL username in the process list (`/proc/<pid>/cmdline`). MySQL supports `MYSQL_USER` environment variable as a safer alternative.

2. **C25-10**: `photo-viewer.tsx` renders capture time with `toLocaleTimeString()` without passing the `locale` variable. The capture date correctly uses `toLocaleDateString(locale, ...)`, but the time uses the browser's default locale, creating inconsistent i18n formatting.

3. **C25-11**: `info-bottom-sheet.tsx` has the same locale bug as C25-10 — `toLocaleTimeString()` called without the `locale` parameter on line 357.

---

## Implementation Steps

### Step 1: C25-09 — Use env vars for MySQL credentials in dumpDatabase and restoreDatabase

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`

**dumpDatabase (lines 112-122):**
- Remove `-h${DB_HOST}`, `-P${DB_PORT || '3306'}`, `-u${DB_USER}` from the spawn arguments
- Add `MYSQL_USER`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE` to the `env` option
- Keep only the positional `DB_NAME` argument (or move to `MYSQL_DATABASE` env var too)
- Actually, `mysqldump` accepts `MYSQL_USER` but still needs the database name as a positional arg. Check: `mysqldump` supports `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PWD`, `MYSQL_TCP_PORT` env vars.
- Replace the spawn args from `['-h${DB_HOST}', '-P${DB_PORT || '3306'}', '-u${DB_USER}', '--single-transaction', '--quick', ...sslArgs, DB_NAME]` to `['--single-transaction', '--quick', ...sslArgs, DB_NAME]`
- Add to env: `MYSQL_USER: DB_USER`, `MYSQL_HOST: DB_HOST`, `MYSQL_TCP_PORT: DB_PORT || '3306'`

**restoreDatabase (lines 306-315):**
- Same approach: remove `-h`, `-P`, `-u` from spawn args
- Add `MYSQL_USER`, `MYSQL_HOST`, `MYSQL_TCP_PORT` to the `env` option
- Keep `--one-database` and `DB_NAME` positional arg

### Step 2: C25-10 — Add locale parameter to toLocaleTimeString in photo-viewer.tsx

**File:** `apps/web/src/components/photo-viewer.tsx`, line 517

Change:
```tsx
{new Date(image.capture_date).toLocaleTimeString()}
```
To:
```tsx
{new Date(image.capture_date).toLocaleTimeString(locale)}
```

### Step 3: C25-11 — Add locale parameter to toLocaleTimeString in info-bottom-sheet.tsx

**File:** `apps/web/src/components/info-bottom-sheet.tsx`, line 357

Change:
```tsx
{new Date(image.capture_date).toLocaleTimeString()}
```
To:
```tsx
{new Date(image.capture_date).toLocaleTimeString(locale)}
```

### Step 4: Verify build

Run `npm run build --workspace=apps/web`.

### Step 5: Run quality gates

Run eslint, tsc --noEmit, vitest.

---

## Files Modified

- `apps/web/src/app/[locale]/admin/db-actions.ts` — use MYSQL_USER/MYSQL_HOST/MYSQL_TCP_PORT env vars instead of CLI flags
- `apps/web/src/components/photo-viewer.tsx` — add locale param to toLocaleTimeString
- `apps/web/src/components/info-bottom-sheet.tsx` — add locale param to toLocaleTimeString

## Risk Assessment

- **Risk:** LOW — All three changes are small, targeted fixes. The env var change for MySQL is a well-documented pattern. The locale changes are one-argument additions with no behavioral regression.
