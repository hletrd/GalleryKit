# Security Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Scope
Restore/backup flows, auth/session writes, mutating admin actions, deployment config, and repository-history security posture.

## Confirmed issues

### S5-01 — Restore mode still allows integrity-breaking concurrent writes
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:235-279`, `apps/web/src/app/actions/images.ts:81-88,180-227`, `apps/web/src/app/actions/admin-users.ts:67-69`, `apps/web/src/app/actions/settings.ts:35-37`, `apps/web/src/app/actions/seo.ts:49-51`, `apps/web/src/app/actions/sharing.ts:61-63`, `apps/web/src/app/actions/topics.ts:33-35,104-106`, `apps/web/src/app/actions/tags.ts:42-44`, `apps/web/src/app/actions/auth.ts:68-70,251-255`
- **Why it matters:** this is a data-integrity/security boundary issue. Restore is a destructive administrative operation, but the current maintenance flag only blocks a subset of write paths.
- **Exploit/failure scenario:** while a privileged admin runs restore, another authenticated session mutates tags/settings/users/passwords or an already-running upload inserts rows into the database. The resulting post-restore state is not the audited dump the admin intended to recover.
- **Suggested fix:** treat restore as a real maintenance window across all conflicting authenticated mutations and upload write boundaries.

## Deferred / operational risk

### S5-R1 — Historical secret exposure remains an operational remediation item
- **Severity:** MEDIUM
- **Confidence:** High
- **Citation:** prior history finding confirmed by repo history for `apps/web/.env.local.example`
- **Reason to defer:** rotating any potentially reused secret and rewriting history/mirrors is operational, not a bounded source-code patch in this cycle.
