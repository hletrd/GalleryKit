# Run-3 Cycle 5 — Security + Correctness angle (security-reviewer, critic, debugger, verifier)

Scope: fresh broad review of the highest-value surfaces flagged by the orchestrator
as under-reviewed relative to the (now-exhausted) Lightroom PAT upload cluster.

## Surfaces examined (full read, no sampling)

| Surface | File | Verdict |
|---|---|---|
| Upload-serve ETag/Cache/Vary + SW interaction | `lib/serve-upload.ts` | CLEAN — multi-cycle hardened |
| Stripe webhook signature + entitlement idempotency | `app/api/stripe/webhook/route.ts` | CLEAN |
| Paid-download single-use token | `app/api/download/[imageId]/route.ts` | CLEAN |
| Refund idempotency + auth | `app/actions/sales.ts` | CLEAN |
| Share-link routes (auth, enumeration, view-count) | `app/[locale]/(public)/s|g/[key]/page.tsx` | CLEAN |
| Image-queue claim/restart races + advisory lock | `lib/image-queue.ts` | CLEAN |
| Smart-collections query compiler (SQLi) | `lib/smart-collections.ts` | CLEAN |
| Public actions (search/load-more/view-record) rate limits | `app/actions/public.ts` | CLEAN |
| Data-layer privacy guard | `lib/data.ts` (publicSelectFields / map / compile-time guards) | CLEAN |
| Semantic search route | `app/api/search/semantic/route.ts` | CLEAN (prod-gated stub) |
| Admin-backfill action | `app/actions/admin-backfill.ts` | CLEAN (R29-CRIT-1 fix present) |

## Detailed notes

### serve-upload.ts
- ETag `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` matches CLAUDE.md
  contract exactly. `If-None-Match` parsing handles `*` and comma lists. `must-revalidate`
  + max-age=3600 documented and consistent across 304/200/HEAD paths. realpath TOCTOU gap
  closed by streaming from resolved path. No issue.

### Stripe webhook
- Signature verified before any DB work; payment_status gate (paid only); zero-amount
  reject; tier allowlist; oversized-email reject BEFORE truncation; idempotent SELECT-then-
  INSERT with ON DUPLICATE KEY belt-and-suspenders. Sentinel placeholder email for missing
  customer email satisfies NOT NULL. PII kept out of error logs. No issue.

### download token route
- Full token shape validated before hash/DB probe. File existence + symlink + traversal
  checks happen BEFORE the atomic single-use claim (C3-RPF-05), so a missing-file failure
  does not consume the token. Atomic `UPDATE ... WHERE downloadedAt IS NULL` with
  affectedRows check. Content-Disposition RFC 6266/5987 encoded. No issue.

### image-queue.ts
- Per-image advisory lock `gallerykit:image-processing:{jobId}` acquired (GET_LOCK 0-timeout)
  before claim-check; released in finally. Conditional `WHERE processed=false` UPDATE; losing
  worker cleans up orphan variants. Bootstrap cursor prevents low-id starvation;
  permanently-failed set (FIFO bounded) prevents infinite re-enqueue. Retry maps bounded.
  Restore-maintenance gates enqueue/bootstrap/continuation. No race or leak found.

### smart-collections.ts
- Column allowlist (typed), depth limit 4, IN-value cap 100, LIKE-wildcard escape, all values
  via Drizzle parameter binding (including `between` sql`` template — placeholders, not
  concat). Tag predicate via parameterized subquery. validateNode mirrors compiler guards.
  No SQL injection vector.

### data.ts privacy
- publicSelectFields / publicMapSelectFields are separate object refs derived by explicit
  omission; compile-time `_PrivacySensitiveKeys` / `_MapSensitiveKeys` guards fire if a
  sensitive key leaks. All color/HDR admin-only fields (color_space, icc_profile_name,
  pipeline_version, transfer_function, is_hdr, etc.) omitted. Airtight.

## Findings

NONE. Every surface carries dense multi-cycle hardening lineage (R-numbers, C-cycle IDs)
and corresponding test locks. No net-new HIGH/MED/LOW actionable finding.

The orchestrator's deferral backlog (DEF-C4-01/02/03 + TEST-C4-01) was fully closed in
run3-cycle4 (HEAD past ad64cff6); no carried deferrals remain.
