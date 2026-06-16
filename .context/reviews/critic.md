# Critic Review — Run-6 Cycle-7

- **HEAD:** `a7758ef0`
- **Agent:** critic
- **Date:** 2026-06-17
- **Angle:** adversarial multi-perspective re-challenge of every load-bearing whole-system invariant + the two recent commits (`5af25dc7` HDR badge contrast, `204e8594` boundary test)
- **Mode:** THOROUGH (no escalation to ADVERSARIAL — zero CRITICAL/MAJOR findings surfaced after a deliberate counterexample hunt)

---

## VERDICT: ACCEPT — 0 CRITICAL / 0 MAJOR / 0 MINOR findings

**Zero findings warranting a commit.** I re-challenged all eight load-bearing whole-system invariants from CODE at HEAD `a7758ef0` (not comments, not test names) and each HOLDS. I specifically tried to break the two newest commits and could not. The production-relevant delta since the cycle-5 baseline (`2f603716`) is exactly **four one-token component edits + two test files** — there is no new schema, server action, API route, lib, encoder path, or data-access change to introduce a violation. An honest 0/0 is the correct outcome for a system at this convergence depth (`11 → 45 → 14 → 5 → 1 → 2 → 0`); I did not manufacture marginal findings.

One INFO-level documentation count drift is disclosed below (privacy union is **20 keys, not 21** as cycle-6 docs narrate). It is NOT a finding: the code-level invariant (`union ≡ SENSITIVE_KEYS ≡ admin−public`) is internally consistent at 20 and the symmetric test enforces it. No commit warranted.

---

## Pre-commitment predictions vs. findings

Before detailed investigation I predicted the highest-risk areas for these two commits:

1. **Did the contrast fix miss a 5th `text-white` gradient site?** → NO. Grep confirms exactly 4 gradient-badge sites, all now `text-amber-950`, zero residual `text-white` on the gradient anywhere in `src/`.
2. **Did either non-`.hdr-badge` site (image-manager, info-bottom-sheet) leak HDR status to non-admins?** → NO. Both are admin-gated (image-manager is mounted only under `admin/(protected)/dashboard`; info-bottom-sheet's badge is gated on `isAdmin && transfer_function in (pq,hlg)`). The contrast fix changed only the text color, not the gate.
3. **Did the badge change introduce a NEW low-contrast pair (e.g., a CSS `color` conflict, or amber-950 on a dark context)?** → NO. The `.hdr-badge` CSS class sets no `color`; forced-colors mode overrides to the always-contrasting `Highlight`/`HighlightText` system pair.
4. **Is the new boundary-test AST descent a false-positive or does it miss type-only forms?** → Neither. Correct value-edge capture, `Set` de-dupe, type-only dynamic-import is correctly noted as non-existent.
5. **Did the boundary commit violate HARD GUARD #1 (add `server-only` to `@/db`)?** → NO. `@/db/index.ts` carries no `server-only`; the test uses the `mysql2`-in-closure signal instead.

All five predicted failure modes investigated and ruled out with code evidence.

---

## Change surface since cycle-5 baseline (`git diff --stat 2f603716 a7758ef0`, production paths)

```
apps/web/src/__tests__/client-server-only-boundary.test.ts | 260 +++++-  (test-only)
apps/web/src/__tests__/hdr-badge-contrast.test.ts          |  85 +++++   (new test)
apps/web/src/components/color-details-section.tsx          |   2 +-      (1 token)
apps/web/src/components/image-manager.tsx                  |   2 +-      (1 token)
apps/web/src/components/info-bottom-sheet.tsx              |   2 +-      (1 token)
apps/web/src/components/lightbox-color-pip.tsx             |   2 +-      (1 token)
```

Everything else in the cycle-5→HEAD diff is `.context/reviews/**` + `plan/**` (docs). No `next.config.ts`, no `nginx/**`, no `sw*.js`, no `messages/**`, no schema, no migration.

---

## Recent-commit vetting

### `5af25dc7` — HDR badge contrast fix (4 sites + fixture)

- **Mechanism:** `text-white` → `text-amber-950` on the `from-amber-300 to-orange-400` gradient at `color-details-section.tsx:526`, `lightbox-color-pip.tsx:151`, `info-bottom-sheet.tsx:278`, `image-manager.tsx:526`. Grep at HEAD: 4/4 sites converted, **zero** residual `text-white`-on-gradient pairings in `src/`.
- **Contrast correctness:** amber-950 on the worst gradient stop (orange-400) = 6.62:1 ≥ 4.5:1 AA (cycle-6 orchestrator math, independently re-stated in the new fixture). The fixture also forbids `text-amber-900` (4.01:1 at orange-400) so a future "darken less" regression fails loud.
- **No CSS conflict:** `.hdr-badge` (globals.css:195-209) sets only `display`/`align-items`/`gap` (+ forced-colors `Highlight`/`HighlightText` system pair) — **no `color` declaration** to fight the inline utility. The two non-`.hdr-badge` sites rely purely on inline classes. No mode (default, force-show, forced-colors) re-introduces a contrast defect.
- **HDR-honesty preserved:** the edit did not touch any `isAdmin` / `transfer_function` gate. All four badges remain admin-only at the data layer (`publicSelectFields` omits `transfer_function`/`is_hdr`) AND the component layer.
- **Fixture quality:** `hdr-badge-contrast.test.ts` is a source-inspection fixture (project convention), non-vacuous (asserts the gradient is present before pinning text color), 4 components × 3 assertions. Runs GREEN at HEAD (`--no-cache`).

### `204e8594` — boundary-test dynamic-import / import-equals coverage

- **Mechanism:** `extractAliasedImports` now adds a `ts.forEachChild` subtree descent (lines 196-218) after the top-level statement loop, capturing (a) dynamic `import('@/lib|@/db')` as `CallExpression` + `SyntaxKind.ImportKeyword` with a string-literal aliased arg (lines 199-205) and (b) `import x = require('@/…')` as `ImportEqualsDeclaration` + `ExternalModuleReference` (lines 209-214), then `Set`-dedupes (line 222).
- **No false-positive:** the comment correctly notes there is no type-only dynamic-import or type-only import-equals-require form, so any aliased specifier on those nodes is a genuine value edge. The descent re-visiting `ImportDeclaration` children is harmless (those subtrees contain neither node form), and de-dupe collapses static+dynamic overlap.
- **HARD GUARD #1 respected:** `@/db/index.ts` UNCHANGED — no `server-only` marker (cycle-5 proved it breaks tsx backfill). The test continues to treat a `mysql2`/`mysql2/promise` import in the closure as the server-only-equivalent signal.
- Runs GREEN at HEAD (18/18 across both changed test files, `--no-cache`).

---

## Invariant verification (each verified from CODE at HEAD)

### 1. Privacy compile-guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) — HOLDS
- `data.ts:416` — `PrivacySensitiveKeys` union enumerated and **counted = 20 members** (sorted: `bit_depth, color_pipeline_decision, color_space, failed_at, filename_original, has_gain_map, icc_profile_name, is_hdr, latitude, longitude, matrix_coefficients, original_file_size, original_format, pipeline_version, processed, processing_error, transfer_function, uploaded_by, user_filename, was_downscaled`).
- `data.ts:418-419` — `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` resolves `never`, so `_privacyGuard` compiles. `typecheck:app` exit 0 → the guard is NOT firing → no real leak.
- **Test cross-check:** `privacy-fields.test.ts` `SENSITIVE_KEYS` sorted set is **byte-identical** to the union (both 20). The symmetric test (`admin − public === SENSITIVE_KEYS`) catches drift in both directions. Ran GREEN 8/8 `--no-cache` this session (the cycle-6 warm-cache flake did NOT reproduce).
- **INFO drift:** cycle-6 `_aggregate.md`/`critic.md` narrate "21-key union"; the actual count is **20**. Off-by-one in the prose only — code, test, and the resolved `never` all agree at 20. No code or doc change warranted (the test pins the real contract).

### 2. Action-origin + api-auth + public-route-rate-limit gates — HOLDS
- `lint:action-origin` → "All mutating server actions enforce same-origin provenance." (last scanned: `topics.ts::setTopicMapVisible`).
- `lint:api-auth` → OK for both `api/admin/**` routes (`db/download`, `lr/upload`). Glob-completeness re-checked: those are the only two routes under `api/admin/`.
- `lint:public-route-rate-limit` → OK (semantic uses helper, similar has no mutating handler, stripe/webhook carries the documented exempt tag).
- All three exit 0 at HEAD.

### 3. Migration journal-hash post-condition (`scripts/migrate.js`) — HOLDS
- `runMigrations` (line 698) → after drizzle `migrate()`, re-reads `__drizzle_migrations`, computes `missing = expectedMigrations.filter(m => !recordedHashes.has(m.hash))` (line 709), and `throw new Error('[Migration] Drizzle silently skipped N migration(s): …')` (line 712-713). Fail-loud intact — catches the non-monotonic-`when` silent-skip class.
- `journalCovered = migrations.every(m => haveHashes.has(m.hash))` (line 683) drives the legacy-reconcile route. Per-entry hashing, not a max-row baseline.

### 4. Advisory-lock no-deadlock (6 named locks) — HOLDS
- All 6 lock names present and each acquired on a dedicated connection released in `finally`/on close. No call site holds two named locks simultaneously; the backfill runner's nested per-image lock is released before the next image with no inverse-order acquirer. No deadlock cycle. (Unchanged from cycle-6; no lock-touching code in the delta.)

### 5. ETag / settings-hash consistency — HOLDS
- `settings-hash.ts:41-53` — `COLOR_IMPACTING_KEYS` enumerated and **counted = 9** (5 color: `wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels` + 3 quality: `image_quality_webp/avif/jpeg` + 1 size: `image_sizes`). `HASH_LENGTH = 8`. Serve-upload folds all 9 into the ETag; static path rides mtime+size (post-flip backfill rewrites). Coherent. (Unchanged from cycle-6.)

### 6. HDR honesty (`is_hdr`/`transfer_function` admin-only until WI-09) — HOLDS (doubly, re-verified post-fix)
- **Data layer:** `publicSelectFields` omits `transfer_function`, `is_hdr`, `color_pipeline_decision`, `matrix_coefficients`, `bit_depth`, `pipeline_version`, `icc_profile_name` → `undefined` for public visitors.
- **Component layer (all 4 badge sites re-read at HEAD):** color-details-section (`isAdmin && isHdr`), lightbox-color-pip (`isAdmin && isHdr`), info-bottom-sheet (`isAdmin && transfer_function in (pq,hlg)`), image-manager (`image.is_hdr`, but the component mounts only under the protected admin dashboard). The contrast commit changed text color only — every gate intact.

### 7. Blur-data-url contract (producer + write + read) — HOLDS (symmetric)
- Producer `process-image.ts` `assertBlurDataUrl`, write `actions/images.ts` `assertBlurDataUrl`, read `photo-viewer.tsx` `isSafeBlurDataUrl`. 3 allowed `data:image/{jpeg,png,webp};base64,` prefixes + 4096-char cap. (Unchanged from cycle-6; no blur code in the delta.)

### 8. Client→server-only boundary guard — HOLDS (and strengthened)
- The HEAD-commit AST classifier now follows the two value-import forms the cycle-5 rewrite dropped, with HARD GUARD #1 intact (no `server-only` on `@/db`; `mysql2`-in-closure signal substitute). Trigger surface remains empty at HEAD (the only dynamic `import('@/…')` is server-side `instrumentation.ts`; zero import-equals-require sites). Genuinely clean today; future-coverage hardened.

---

## Multi-perspective notes

- **Executor:** Nothing to build — the delta is four already-applied one-token edits plus two tests. Zero ambiguity.
- **Stakeholder:** The HDR-badge a11y carry-forward (the only real finding of the prior cycle) is now closed and pinned against regression. The invariant surface is at steady state. The marginal value of another pure-invariant sweep is near zero; the next genuinely useful pass would be a *fresh-angle* feature-behavior audit, not an eighth invariant re-litigation.
- **Skeptic:** I deliberately hunted for (a) a missed 5th badge site, (b) an HDR-status leak via the two ungated-by-`isAdmin`-prop badges, (c) a CSS-vs-inline color conflict, (d) an amber-950-on-dark new failure, and (e) a boundary-test false-positive/negative. Each dissolved under grep + mount-trace + CSS read + AST read. The strongest candidate for a finding (image-manager's `is_hdr`-only gate with no `isAdmin` prop) is sound because the component is admin-route-exclusive.

---

## Realist Check

No CRITICAL/MAJOR/MINOR findings to recalibrate. The one disclosed item (privacy union = 20 not 21) is a prose count drift with zero runtime/security/correctness impact — the code, the test, and the resolved-`never` guard all agree at 20, so there is nothing to fix and no severity to assign. The cycle-6 warm-vitest-cache privacy flake did NOT reproduce this session (8/8 `--no-cache` GREEN), consistent with it having been a tooling artifact.

---

## Hard-guard compliance

- Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks the tsx-run production backfill scripts — REJECT).
- Did NOT propose activating CLIP / semantic-search.
- Did NOT re-report any cycle 1-6 item; every claim re-verified against HEAD `a7758ef0`.

---

## Evidence of green at HEAD `a7758ef0`

- `lint:action-origin` — PASS (exit 0)
- `lint:api-auth` — PASS (exit 0)
- `lint:public-route-rate-limit` — PASS (exit 0)
- `typecheck:app` — PASS (exit 0; route types generated; privacy compile-guard NOT firing)
- `vitest run hdr-badge-contrast.test.ts client-server-only-boundary.test.ts --no-cache` — 18/18 PASS
- `vitest run privacy-fields.test.ts --no-cache` — 8/8 PASS (no flake)
- Grep — zero `text-white` on `from-amber-300 to-orange-400` anywhere in `src/`
- Grep — `@/db/index.ts` carries no `server-only` marker
- Code count — `PrivacySensitiveKeys` = 20 ≡ `SENSITIVE_KEYS` = 20; `COLOR_IMPACTING_KEYS` = 9

---

## Open Questions (unscored)

- **Privacy-union narrative count (20 vs. 21):** the cycle-6 aggregate/critic prose says "21-key union"; the on-disk union at `data.ts:416` has 20 members, matching `SENSITIVE_KEYS` exactly. Pure documentation drift, no code/test/guard inconsistency, no fix warranted. Flagged only so a future cycle does not "add a 21st key" to chase a phantom count.
- **Diminishing returns on invariant sweeps:** seven consecutive cycles confirm the same eight invariants. A fresh-angle review (feature/behavior, accessibility-beyond-contrast, or a real end-to-end data-flow audit against a live DB) would surface more than another invariant re-challenge. Process observation, not a code finding.
