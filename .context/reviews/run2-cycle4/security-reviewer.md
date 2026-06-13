# Security + Correctness Review — Run-2 Cycle 4 (HEAD 2508f132)

Date: 2026-05-30
Method: direct orchestrator review (Task-based subagent fan-out unavailable in
this nested execution context — `Error: No such tool available: Task`, same as
run-2 cycles 1-3). All angles executed directly, one provenance file per angle.

## Verdict: ZERO net-new findings (CRIT 0 / HIGH 0 / MED 0 / LOW 0)

## Surfaces independently verified clean

| Surface | File(s) | Evidence |
|---|---|---|
| Privacy field separation | `lib/data.ts:181-396` | `adminSelectFields` is the full PII set; `publicSelectFields` + `publicMapSelectFields` are separate object references built by explicit `_omit` destructuring. `_PrivacySensitiveKeys` (20 keys incl. `color_space`, `icc_profile_name`, `pipeline_version`, GPS, filenames) drives the compile-time `_privacyGuard` AND the symmetric runtime test (`__tests__/privacy-fields.test.ts:82-89`) which asserts admin∖public == EXACTLY `SENSITIVE_KEYS`. `avif_10bit` is intentionally in BOTH sets (public delivered-bit-depth chip) so it correctly does not appear in the admin-only difference. Triple-enforced; airtight. |
| In-app backfill server action | `actions/admin-backfill.ts` | `triggerBackfill` calls `isAdmin()` then stores `requireSameOriginAdmin()` result and returns early; `getBackfillStatus` carries `@action-origin-exempt` comment (read-only). Both lint gates pass. |
| Stripe webhook | `api/stripe/webhook/route.ts` | Mandatory `constructStripeEvent` signature verification before any processing; `session_id` UNIQUE for idempotency; tier allowlist-validated from metadata (C1RPF-PHOTO-MED-02); NO_STORE headers; `@public-no-rate-limit-required` documented (signature-gated). |
| Download token route | `api/download/[imageId]/route.ts` | `isValidTokenShape` rejects malformed before DB; `hashToken` + `verifyTokenAgainstHash` constant-time; single-use claim semantics; route correctly outside `/api/admin/`. |
| API-auth lint gate | `scripts/check-api-auth.ts` | `lint:api-auth` OK — both admin route handlers wrap `withAdminAuth`. |
| Action-origin lint gate | `scripts/check-action-origin.ts` | `lint:action-origin` OK — all mutating server actions enforce same-origin provenance. |
| Migration drift / silent-skip | `scripts/migrate.js` | Per-entry SHA256 (`getAllJournalMigrations`), `every(hash present)` coverage check (not `MAX(created_at)`), `reconcileLegacySchema` covers latest columns (`avif_10bit`, `uploaded_by` + FK + index), and `runMigrations` post-condition throws "Drizzle silently skipped N migration(s)". The known non-monotonic `when` at journal idx 7 (0007_image_reactions, 2025 ts) is exactly the documented hazard and is now defended by the hash-coverage path. |
| Validation / injection defenses | `lib/validation.ts`, `lib/csv-escape.ts` | Unicode bidi + zero-width stripping and CSV formula-injection escaping present per CLAUDE.md lineage; no concatenated untrusted SQL in audited surfaces. |

## TODO/FIXME audit
Only 2 source markers, both scoped out-of-scope feature stubs (US-P51 CLIP ONNX
inference; US-P54-phase2 email pipeline). Neither is a bug or security gap.

## Note on honesty
Per cycle-context honesty rule: a thorough independent pass found nothing
actionable. No marginal findings manufactured. This is a convergence signal.
