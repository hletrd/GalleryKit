# Verifier — Deep Review (cycle 3 / HEAD b1e9e0da)

Role: evidence-based correctness verification of the repo's most load-bearing
behavioral CLAIMS (from CLAUDE.md + code comments) against the actual code and
tests at HEAD `b1e9e0da8466b10113ac5a6065d570382f92c292`.

## Verdict

**Status**: PASS
**Confidence**: high
**Blockers**: 0

All 10 high-value claims are VERIFIED against current code. No CONTRADICTED
claims. One claim (Stripe async gap) is verified WITH AN IMPORTANT NUANCE that
strengthens, not weakens, the documented posture — see CLAIM 10.

## Fresh Evidence (test runs at HEAD b1e9e0da)

| Batch | Command | Result |
|-------|---------|--------|
| privacy/csv/blur/touch | `npx vitest run --no-file-parallelism privacy-fields csv-escape blur-data-url touch-target-audit` | **4 files, 63 tests passed** |
| rate-limit/semantic/backfill/blur-wiring | `npx vitest run --no-file-parallelism auth-rate-limit auth-rate-limit-ordering semantic-route-production semantic-search-mode-validator backfill-color-pipeline admin-backfill-runner-detection-failure process-image-blur-wiring images-action-blur-wiring` | **8 files, 42 tests passed** |
| **TOTAL** | 12 claim-relevant test files | **105 tests passed, 0 failed** |

(stderr noise in the backfill batch — `[verify-avif] no NCLX colr box`,
`[admin-backfill] detection failed` — are intentional fixture diagnostics, not
failures; both files report all tests green.)

Note: the full suite + `npm run typecheck` were NOT run in this pass (sandbox
killed the broad vitest invocation with exit 144; ran targeted serial batches
instead). The compile-time guards (CLAIM 1) are verified by code inspection of
the type assertions, which live inside `tsconfig.typecheck.json`'s scope; a
clean `typecheck` is the gating CI mechanism for them.

---

## Claim-by-Claim Verification

### CLAIM 1 — `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guards actually fail compilation on leak
**Verdict: VERIFIED (High)**

Evidence — `apps/web/src/lib/data.ts`:
- L416 canonical union: `PrivacySensitiveKeys = 'latitude' | 'longitude' | 'filename_original' | 'user_filename' | 'processed' | 'original_format' | 'original_file_size' | 'color_pipeline_decision' | 'is_hdr' | 'has_gain_map' | 'was_downscaled' | 'transfer_function' | 'matrix_coefficients' | 'bit_depth' | 'uploaded_by' | 'processing_error' | 'failed_at' | 'color_space' | 'icc_profile_name' | 'pipeline_version'`
- L418-420: the guard is a real type-level computation, not a comment:
  ```ts
  type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
  const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: ...'] = true;
  ```
  If any sensitive key is present in `publicSelectFields`, `Extract` yields a
  non-`never` union, the conditional resolves to the `[key, 'ERROR...']` tuple
  type, and `= true` fails to assign → **tsc compile error**. This is a genuine
  fail-compilation guard.
- L429-432 mirrors it for `publicMapSelectFields` with `Exclude<…,'latitude'|'longitude'>` (map is allowed exactly GPS, nothing else).
- L447-450 `_largePayloadGuard` blocks `blur_data_url` from the listing select by the same mechanism.

Runtime backstop confirmed by test: `__tests__/privacy-fields.test.ts:58-59`
`for (const key of SENSITIVE_KEYS) expect(publicSelectFieldKeys).not.toContain(key)`
and L83 "admin-only keys form exactly the SENSITIVE_KEYS contract (symmetric
guard)". The 63-test green batch includes this file. **Belt (compile) + braces
(runtime fixture) both present.**

### CLAIM 2 — CLIP disabled-by-design healing logic
**Verdict: VERIFIED (High)** — and the HARD GUARD is satisfied: NOT proposing activation; verifying the disable is correct.

Evidence — `apps/web/src/lib/gallery-config.ts` `_getGalleryConfig` L129-147:
```ts
const raw = getSetting(map, 'semantic_search_mode');
if (!isValidSettingValue('semantic_search_mode', raw)) return DEFAULTS.semantic_search_mode  // 'disabled'
const value = raw as 'disabled' | 'stub' | 'production';
if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
    return 'disabled';
}
return value;
```
- Default is `'disabled'` (invalid/unknown → disabled, L132).
- Stored `'production'` HEALS to `'disabled'` UNLESS `SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true'` (L143-145). Exactly as claimed.
- DB-read failure path L188-200 also returns `DEFAULTS.semantic_search_mode` ('disabled') — fail-safe.

Tests green: `semantic-route-production.test.ts` + `semantic-search-mode-validator.test.ts` both pass in the 42-test batch. The healing is correct; activation is NOT proposed.

### CLAIM 3 — admin-backfill-runner and sidecar script persist the SAME DB column set
**Verdict: VERIFIED (High)**

Success-path UPDATE column set is identical (10 columns) in both paths:

`apps/web/src/lib/admin-backfill-runner.ts:559-568`:
`pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`

`apps/web/scripts/backfill-color-pipeline.ts:371+` — same 10 columns (confirmed via the column-object build at L212-220).

Detection-failure semantics ALSO match (the CLAUDE.md "no version bump on
detection failure" claim):
- runner L594-599: on detection failure, UPDATE persists ONLY `was_downscaled, avif_10bit` and does NOT bump `pipeline_version` (L580-593 comment explicitly aligns the in-app runner with the operator script's correct semantics).
- sidecar L94-105 + L225-232 `derivativeOnly: { was_downscaled, avif_10bit }` — same shape.

Tests green: `backfill-color-pipeline.test.ts` (column-set lock) and
`admin-backfill-runner-detection-failure.test.ts` (AGG-01: "issues an UPDATE
without pipeline_version so the row is re-picked next run") both pass — the
latter's stderr confirms the failure path fires and the run completes with
`detectionFailures=1` and no version bump.

### CLAIM 4 — migrate.js post-condition: every journal hash MUST be in __drizzle_migrations, otherwise throw; covers all entries
**Verdict: VERIFIED (High)**

Evidence — `apps/web/scripts/migrate.js`:
- L750 `const journalMigrations = getAllJournalMigrations(migrationsFolder);` — reads the FULL journal (one record per entry, `folderMillis = entry.when`, `hash = SHA256(file)` per `getAllJournalMigrations` at L144).
- L760 `await runMigrations(connection, migrationsFolder, journalMigrations);` — passes the FULL journal as `expectedMigrations`.
- L698-718 `runMigrations`: after `migrate()`, computes `const missing = expectedMigrations.filter((m) => !recordedHashes.has(m.hash));` and `if (missing.length > 0) throw new Error('[Migration] Drizzle silently skipped N migration(s): tags…')`.

The post-condition covers ALL journal entries (the array passed is the complete
`getAllJournalMigrations` result, not a subset). The reconcile pre-step
(L682-695) uses `migrations.every((m) => haveHashes.has(m.hash))` to decide
whether to baseline. Both the "did drizzle skip" assertion and the
hash-completeness reconcile are wired and complete. Matches CLAUDE.md exactly.

### CLAIM 5 — blur-data-url contract enforced at producer + write + read (3 points)
**Verdict: VERIFIED (High)**

- **Producer**: `apps/web/src/lib/process-image.ts:895` `blurDataUrl = assertBlurDataUrl(candidate);` (import L17). The cycle-4 producer-side wrap.
- **Write**: `apps/web/src/app/actions/images.ts:352` `blur_data_url: assertBlurDataUrl(data.blurDataUrl),` (import L28) — sanitized at DB-write time in `uploadImages`.
- **Read**: `apps/web/src/components/photo-viewer.tsx:196` `if (!isSafeBlurDataUrl(value)) return undefined;` (import L35) — gates the `backgroundImage: url(...)` render.

Contract itself (`apps/web/src/lib/blur-data-url.ts`): `ALLOWED_PREFIXES` =
`data:image/{jpeg,png,webp};base64,` (L33-37); `MAX_BLUR_DATA_URL_LENGTH = 4096`
(L45); `isSafeBlurDataUrl` checks type+length+prefix (L47-51). All three points
present.

Tests green: `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts`, `blur-data-url.test.ts` all pass.

### CLAIM 6 — CSV escape strips bidi + zero-width + formula + C0/C1
**Verdict: VERIFIED (High)**

Evidence — `apps/web/src/lib/csv-escape.ts` `escapeCsvField`:
1. **C0/C1 strip** L44: `value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')` (preserves CR/LF for the collapse pass).
2. **Bidi + zero-width strip** L54: `value.replace(UNICODE_FORMAT_CHARS_G, '')` where (validation.ts:58) `UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/`. Covers: bidi overrides U+202A-202E, isolates U+2066-2069, ZWSP/ZWNJ/ZWJ/LRM/RLM U+200B-200F, WJ U+2060, BOM U+FEFF, MVS U+180E, interlinear U+FFF9-FFFB. The `_G` variant (L7) adds the global flag without polluting the shared `.test()` regex's lastIndex.
3. **CRLF collapse** L55: `value.replace(/[\r\n]+/g, ' ')`.
4. **Formula prefix** L60-62: `if (/^\s*[=+\-@]/.test(value)) value = "'" + value;` — leading-whitespace-tolerant so a CRLF-collapsed space cannot bypass the guard. Tab is pre-stripped by the C0/C1 pass (documented dead-code removal C8R-RPL-05).
5. **Quote wrap** L63: `'"' + value.replace(/"/g, '""') + '"'`.

Each documented class is stripped/guarded. Test green: `csv-escape.test.ts`.

### CLAIM 7 — Touch-target 44px audit catches multi-line Button/Badge/select
**Verdict: VERIFIED (High)**

Evidence — `apps/web/src/__tests__/touch-target-audit.test.ts`:
- **Multi-line normalization**: `normalizeMultilineButtonTags` (L612) + `findJsxTagEnd` (L561-610) walk char-by-char tracking string/template/brace depth and skipping `//` and `/* */` comments, returning the tag's true closing `>` only at `braceDepth === 0 && prev !== '='`. The `prev !== '='` check (L600) is exactly the documented `=>`-arrow rejection so a `() => ...` event handler inside the tag doesn't prematurely close it.
- **Badge coverage** L396-401: FORBIDDEN entries match `<Badge … asChild … className="…min-h-[<44px]…">` (string-literal) and the `cn()` composite form, with a negative lookahead for `h-1[12]/min-h-1[12]/size-1[12]` overrides.
- **Native select coverage** L415-441: literal `h-8/h-9/h-10`, `cn()` composite, scale-token catch-all `{min-h|h}-(1..10)`, and arbitrary `min-h-[<44px]` forms — with `(?<!max-)` to avoid matching `max-h-…`.
- KNOWN_VIOLATIONS deltas documented (L186 multi-line count raise, L193 native-select absorption).

Test green: `touch-target-audit.test.ts` passes (part of the 63-test batch).

### CLAIM 8 — Rate limiting: per-IP AND per-account buckets, both enforced with eviction
**Verdict: VERIFIED (High)**

Evidence — `apps/web/src/lib/auth-rate-limit.ts`:
- **Per-IP** map: `loginRateLimit` (imported from `@/lib/rate-limit`), windowed via `getLoginRateLimitEntry` (L21-29) which zeroes count after `LOGIN_WINDOW_MS`.
- **Per-account** map: `accountLoginRateLimit = createWindowBoundedMap<string>(LOGIN_RATE_LIMIT_MAX_KEYS, LOGIN_WINDOW_MS)` (L19) — same cap + window, keyed by `acct:<sha256-prefix>`. `getAccountLoginRateLimitEntry` (L31-39) applies the same windowing.
- **Eviction**: both maps are `createWindowBoundedMap` instances (bounded capacity with oldest-entry eviction via `.prune()`); `pruneAccountLoginRateLimit` (L92-94) exposes the prune. DB-backed buckets `'login'` and `'login_account'` are the cross-restart source of truth (L47, L56, L88); the in-memory maps are the fast-path fallback.
- Rollback (decrement-not-delete) for both: `rollbackLoginRateLimit` (L66-74) and `rollbackAccountLoginRateLimit` (L81-89), preventing concurrent-rollback count loss (C1-07).

Both buckets exist, both are windowed, both are bounded with eviction. Tests
green: `auth-rate-limit.test.ts` + `auth-rate-limit-ordering.test.ts`.

### CLAIM 9 — publicSelectFields derived from adminSelectFields by omitting PII; GPS/filename_original/user_filename absent
**Verdict: VERIFIED (High)**

Evidence — `apps/web/src/lib/data.ts`:
- `adminSelectFields` (L208-278) is the FULL set including `latitude` (L236), `longitude` (L237), `filename_original` (L210), `user_filename` (L221).
- `publicSelectFields` is DERIVED by destructuring-omit from `adminSelectFields` (L325-357): the destructure explicitly pulls out `latitude, longitude, filename_original, user_filename, original_format, original_file_size, processed, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version` and spreads `...publicSelectFieldCore` into `publicSelectFields`. It is a SEPARATE object reference (L355-357), so adding a field to admin does NOT auto-leak to public — confirmed by the L318-324 comment + the L416-420 compile guard (CLAIM 1).
- `publicMapSelectFields` (L366-393) re-derives, retaining ONLY latitude/longitude vs public, guarded by `_mapPrivacyGuard` (L431).

Runtime confirmation: `publicSelectFieldKeys` (L399-401, frozen sorted keys);
`privacy-fields.test.ts:58-59` asserts none of `['latitude','longitude','filename_original','user_filename']`
appear in `publicSelectFieldKeys`. Test green.

### CLAIM 10 — Stripe async_payment_succeeded gap is unhandled (as CLAUDE.md admits)
**Verdict: VERIFIED with NUANCE (High)** — gap is real at the webhook layer; operationally closed at the checkout layer.

Evidence:
- **Webhook DOES NOT handle async settlement**: `apps/web/src/app/api/stripe/webhook/route.ts:88` handles only `checkout.session.completed`; L105-118 gates `if (session.payment_status !== 'paid') { … return {received:true} }`. An async method that fires `completed` with `payment_status: 'unpaid'` is REJECTED (no entitlement minted). There is NO `checkout.session.async_payment_succeeded` case — confirmed by grep: the string appears only in COMMENTS (webhook route.ts:99 "a future cycle should add a handler"; checkout route.ts:198/201/206). So the later settlement event is genuinely dropped → matches CLAUDE.md "complete checkout but never receive an entitlement row."
- **NUANCE — checkout route closes the gap operationally**: `apps/web/src/app/api/checkout/[imageId]/route.ts:207` hard-pins `payment_method_types: ['card']` with an explicit L196-206 comment ("Forcing card-only makes completed+unpaid unreachable, closing the gap operationally. DO NOT add async methods here before the async_payment_succeeded handler ships."). Card is immediate-capture, so the `completed+unpaid` path the webhook would mishandle is **unreachable in production** as currently configured.

This means the "money-taken-no-goods" risk is NOT live: the only way to trigger
it is to add an async method to `payment_method_types`, which the code forbids.
CLAUDE.md's admission is accurate (the handler is absent); the production
exposure is mitigated. Test pin: `checkout-route.test.ts:206` pins the card-only
config so a future regression that re-introduces async methods fails CI.

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Privacy compile guard fails on leak | VERIFIED | data.ts:416-420 type assertion + privacy-fields.test.ts |
| 2 | CLIP heals production→disabled unless env opt-in | VERIFIED | gallery-config.ts:143-145; semantic tests green |
| 3 | Backfill paths persist identical column set | VERIFIED | admin-backfill-runner.ts:559-568 == backfill-color-pipeline.ts:371+ |
| 4 | migrate.js throws on skipped journal entries, full coverage | VERIFIED | migrate.js:709-718 over full journalMigrations (L750/L760) |
| 5 | blur-data-url enforced at 3 points | VERIFIED | process-image.ts:895, images.ts:352, photo-viewer.tsx:196 |
| 6 | CSV strips bidi+zero-width+formula+C0/C1 | VERIFIED | csv-escape.ts:44/54/55/60-62 + validation.ts:58 |
| 7 | Touch-target audit catches Button/Badge/select multi-line | VERIFIED | touch-target-audit.test.ts findJsxTagEnd:600, FORBIDDEN:396-441 |
| 8 | Rate limit per-IP + per-account both bounded | VERIFIED | auth-rate-limit.ts:19/21-39/92-94 |
| 9 | publicSelectFields omits GPS/filenames, derived | VERIFIED | data.ts:325-357; privacy-fields.test.ts:58-59 |
| 10 | Stripe async gap unhandled | VERIFIED (nuance) | webhook:88/105; checkout:207 card-only mitigation |

## Gaps
- None blocking. The only "gap" (CLAIM 10) is an explicitly documented,
  test-pinned, operationally-closed deferral, not a defect.

## Recommendation
**APPROVE** — all 10 load-bearing behavioral claims hold against current code at
HEAD b1e9e0da, with 105 fresh claim-relevant tests passing and concrete
file+line evidence for each. No contradictions found. The Stripe deferral is
honestly documented and operationally mitigated by the card-only checkout pin.
