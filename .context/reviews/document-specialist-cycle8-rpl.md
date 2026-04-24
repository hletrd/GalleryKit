# Document Specialist — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** doc/code alignment after cycle-7-rpl CLAUDE.md updates
(account-scoped login limit, UPLOAD_MAX_* variable names).

## Findings

### DS8-01 — CLAUDE.md advisory-lock section doesn't note DB-server scoping [LOW, MEDIUM]

**File:** `CLAUDE.md` "Race Condition Protections" section.

**Observation:** the section documents that advisory locks
(`GET_LOCK`) are session-scoped. It does NOT document that the lock
NAMES are DB-server-scoped (shared across all databases on the
same MySQL server). Per S8-05, two GalleryKit instances on one
MySQL server would interfere.

**Severity:** LOW, MEDIUM.

**Suggested fix:** add a line: "Advisory-lock names
(`gallerykit_db_restore`, `gallerykit:image-processing:*`, etc.) are
scoped to the MySQL server, not the database. Running multiple
GalleryKit instances against a single MySQL server will serialize
restores, topic-rename, and image-processing across instances. Run
one GalleryKit per MySQL server, or prefix lock names with a
per-instance identifier."

### DS8-02 — README nginx snippet TRUST_PROXY still not explicit [LOW, MEDIUM]

Carry-forward from AGG7R-06 deferred. README still doesn't
explicitly show:
- `proxy_set_header X-Real-IP $remote_addr;` (overwrite, not
  append).
- `TRUST_PROXY=true` in `.env.local.example` as a commented example.

**Severity:** LOW.

**Status:** deferred — see `plan/plan-222-cycle7-rpl-deferred.md`.

### DS8-03 — CLAUDE.md "Security Architecture" doesn't mention
Unicode bidi/CSV strips [LOW, LOW]

**File:** `CLAUDE.md` "Database Security" section mentions CSV
escaping but not the cycle-7-rpl Unicode bidi strip. Operators
auditing the security posture might miss this defense-in-depth
layer.

**Severity:** LOW, LOW.

**Suggested fix:** add to the CSV bullet: "CSV export escapes
formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`),
strips C0/C1 control chars, and strips Unicode bidi override
characters (U+202A-202E, U+2066-2069) to prevent Trojan-Source
visual-reordering attacks."

### DS8-04 — `plan/plan-221-cycle7-rpl-polish.md` references
`SET @ — lint` gate that isn't listed in CLAUDE.md [INFO]

**File:** plan-221 references `npm run lint:api-auth` and
`npm run lint:action-origin` gates. CLAUDE.md "Testing" section
lists:
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- `npm run lint --workspace=apps/web`

**Observation:** the custom lint gates `lint:api-auth` and
`lint:action-origin` are NOT documented in CLAUDE.md. They exist
as `package.json` scripts and are enforced by this loop's GATES
list but a future contributor reading CLAUDE.md would miss them.

**Severity:** LOW, HIGH.

**Suggested fix:** add a line under "Testing" in CLAUDE.md:
"Additional repo-specific lint gates:
- `npm run lint:api-auth --workspace=apps/web` — asserts every
  `/api/admin/**` route runs an `isAdmin()` check.
- `npm run lint:action-origin --workspace=apps/web` — asserts every
  mutating server action calls `requireSameOriginAdmin()`.
Both are run in CI and by the orchestrator's GATES list."

### DS8-05 — CLAUDE.md doesn't document the `deploy` script [INFO]

**File:** CLAUDE.md "Remote Deploy Helper" section exists and
documents `npm run deploy` + `.env.deploy`. Current and correct.

**Status:** no finding.

### DS8-06 — `plan/plan-222-cycle7-rpl-deferred.md` AGG7R-05 status wrong [LOW, HIGH]

**File:** `plan/plan-222-cycle7-rpl-deferred.md:17-23`.

**Observation:** the file lists AGG7R-05 under "Deferred findings"
but states "being IMPLEMENTED as T7R-11 in plan-221" and "Status:
NOT deferred (see plan-221)". Having it under "Deferred findings"
heading is inconsistent with the "NOT deferred" status.

**Severity:** LOW, HIGH.

**Suggested fix:** either move AGG7R-05 to a separate "Implemented
this cycle" sub-heading or remove it from the deferred file
entirely (since it IS implemented, the record belongs in plan-221).

### DS8-07 — `plan/plan-221-cycle7-rpl-polish.md` references
`escapeCsvField` line numbers that may drift [LOW, MEDIUM]

**File:** plan-221 references `csv-escape.ts:16-20`,
`csv-escape.ts:15-22`, etc. The file is tiny (39 lines), so drift
is unlikely, but line-number citations in historical plans age
poorly.

**Severity:** LOW, MEDIUM.

**Status:** acknowledged. Future plans should cite function names
not line ranges where possible.

## Summary

DS8-01 (advisory-lock DB-scoping note) and DS8-04 (custom-lint-gate
documentation) are the two most actionable docs fixes. Both are
small.
