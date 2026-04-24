# Security Reviewer — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** full repository security surface after cycle-7-rpl landings.

## Findings

### S8-01 — Upload tracker first-insert race as DoS amplifier [LOW, MEDIUM]

**File:** `apps/web/src/app/actions/images.ts:127-176`

Same race condition as CR8-01. From a security angle: the cumulative
upload limit (`UPLOAD_MAX_FILES_PER_WINDOW = 100`,
`MAX_TOTAL_UPLOAD_BYTES = 2 GiB` per 1-hour window per IP) is
bypassable on the FIRST burst from a cold IP. An attacker with N
parallel connections from a single IP can land up to N × 100 files
or N × 2 GiB in a single hour before the tracker stabilizes.

**Mitigation already in place:** the admin must be authenticated.
The rate-limit layers (login, DB-backed bucket) still apply. The
per-call caps (100 files, 2 GiB) still bound each invocation. The
cumulative-across-calls limit is the only one affected.

**Impact:** LOW. The bypass is finite (bounded by request
parallelism), requires valid admin credentials, and only extends the
first-hour budget. No auth/crypto surface.

**Fix:** same as CR8-01. Immediate `uploadTracker.set(...)` on
missing-entry branch BEFORE first await.

### S8-02 — `stripSqlCommentsAndLiterals` does NOT strip nested block comments [LOW, MEDIUM]

**File:** `apps/web/src/lib/sql-restore-scan.ts:63`

**Behavior:** the block-comment strip `/\/\*.*?\*\//gs` is
non-greedy and handles single-level `/* ... */`. MySQL 8.0 does not
support nested block comments in standard SQL mode, so this is
correct for valid SQL. However, the CONDITIONAL-comment strip at
line 61 `/\/\*!(\d{5,6})\s*([\s\S]*?)\*\//g` runs FIRST and replaces
conditional comments with their inner text. If an attacker crafts a
dump with `/*!80000 /* GRANT */ */` (block comment nested INSIDE a
conditional), the outer conditional is stripped → inner becomes
`/* GRANT */` → then block-comment strip removes that, hiding the
GRANT.

Wait — let me trace: step 1 extracts inner content of
`/*!80000 ... */`. The inner is `/* GRANT */`. Step 2 strips
`/* GRANT */` via `/\/\*.*?\*\//gs`. Result: empty string. So an
attacker cannot smuggle GRANT via nested conditionals — the nested
`/* */` is stripped and the token is gone.

**Impact:** no finding. The layered stripping is correct.

**Status:** resolved on re-analysis. No issue.

### S8-03 — `escapeCsvField` zero-width character class omission [LOW, LOW]

**File:** `apps/web/src/lib/csv-escape.ts:26-30`

**Behavior:** bidi overrides (U+202A-202E, U+2066-2069) are stripped.
Other potentially-confusing Unicode classes NOT stripped:
- Zero-width characters: U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ),
  U+FEFF (ZWNBSP/BOM).
- Invisible format chars: U+2060 (WJ), U+180E (MVS).
- Variation selectors: U+FE00-FE0F, U+E0100-E01EF.

**Impact:** visual confusion in spreadsheets. Zero-width chars can
hide content or create copy-paste traps. Not classic Trojan-Source
bidi, but a sibling concern.

**Exposure:** admin-generated CSV only — data origin is the DB, which
sanitizes on ingest via `stripControlChars`. Exposure is low; this
would only matter if an admin pasted zero-width text into a title
field (which `stripControlChars` does NOT strip — it only strips C0/C1
controls and some formatting, not ZWSP).

**Suggested fix:** extend the bidi-strip regex to include U+200B-200F,
U+2060, U+FEFF, U+180E, and U+FE00-FE0F. Defense-in-depth.

### S8-04 — `hasTrustedSameOrigin` accepts referer with path component [LOW, LOW]

**File:** `apps/web/src/lib/request-origin.ts:84-86`

**Behavior:** when no `Origin` header is present, falls back to
`Referer`. `Referer` includes full URL path, which is normalized to
its origin via `toOrigin(referer)`. This correctly extracts the
origin. However, `Referer` can be forged by browser extensions or
absent entirely. The `sameSite: 'lax'` cookie already provides CSRF
defense for the state-changing action path.

**Impact:** no additional risk. The `Referer` fallback is only
relevant when `Origin` is unset, which is uncommon in modern
browsers for state-changing requests.

**Status:** no finding; defense-in-depth is appropriately layered.

### S8-05 — MySQL advisory lock name collision risk across multi-tenant [LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:264`,
`apps/web/src/app/actions/topics.ts:43`,
`apps/web/src/app/actions/admin-users.ts:194`,
`apps/web/src/lib/image-queue.ts:111-113`

**Behavior:** advisory lock names are literal strings:
`gallerykit_db_restore`, `gallerykit_topic_route_segments`,
`gallerykit_admin_delete`, and `gallerykit:image-processing:<id>`.
If multiple GalleryKit instances share a single MySQL server
(multi-tenant hosting), they ALL take the same advisory locks and
mutually exclude each other.

**Impact:** cross-tenant interference. An operator running two
separate instances against one DB server (rare, but not forbidden)
would see restore/topic/admin operations serialize across
instances.

**Documentation alignment:** CLAUDE.md documents advisory locks but
doesn't mention the lock-name scope. The repo is single-user and the
deployment guide assumes one DB per instance, so this is a
deployment-note concern only.

**Suggested fix:** prefix advisory lock names with `DB_NAME` so
multi-tenant deployments naturally scope. Example:
`${DB_NAME}:gallerykit_db_restore`. Documentation-only alternative:
add a NOTE to CLAUDE.md advisory-locks section saying "lock names
are DB-server-scoped; run one GalleryKit per DB server".

### S8-06 — `MYSQL_PWD` env var leak window via `/proc/<pid>/environ` [LOW, LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:142, 398`

**Behavior:** `mysqldump` and `mysql` are spawned with
`MYSQL_PWD: DB_PASSWORD` in env. MySQL-recommended alternative
(`~/.my.cnf`) is disabled via `HOME` exclusion. `/proc/<pid>/environ`
is readable by the process owner, so any local user in the container
running as the same UID sees the password.

**Mitigation:** Docker containers run as a dedicated user. Server
processes should not be accessible to other local users.

**Impact:** no exploit path under normal Docker deployment.

**Status:** acknowledged defense-in-depth posture already documented.
No finding.

### S8-07 — Rate-limit bucket-start floor creates brief window at rollover [LOW, LOW]

**File:** `apps/web/src/lib/rate-limit.ts:162-166`

**Behavior:** `getRateLimitBucketStart` floors to the window boundary.
At the instant a window rolls over (e.g., at `:00`), the bucket
advances and the previous window's count is effectively zero. An
attacker timing requests across the boundary can briefly land
`LIMIT - 1` (previous) + `LIMIT` (new) = near 2× requests in a small
delta.

**Impact:** standard windowed-rate-limit behavior. Sliding windows
(Redis leaky-bucket or token-bucket) mitigate this; windowed is the
documented choice and matches OWASP's baseline.

**Status:** by-design tradeoff. No finding.

## Summary

One actionable LOW-severity finding (S8-01 / CR8-01 upload tracker
first-insert race). One nice-to-have hardening (S8-03 zero-width
strip). One multi-tenant deployment note (S8-05 advisory lock name
scoping). All other checks pass. Security posture remains strong.
