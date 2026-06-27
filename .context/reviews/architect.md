# Architect Review — Cycle 16

**Date:** 2026-06-27
**HEAD:** 1f5fb245
**Scope:** Layering integrity, process-local state vs single-writer topology, abstraction integrity (storage quarantine + public/admin field split), migration/schema as architecture, structural "fix-one-sibling-miss-the-next" coupling.
**Method:** Read-only. Every finding cited file:line. Confirmed cycle-15 A15-01/A15-02 fixes landed (commit `0f03beea`); hunted the NEXT siblings.

---

## Summary Table

| ID | Finding | File:line | Conf | Sev |
|----|---------|-----------|------|-----|
| A16-01 | Two PUBLIC anonymous search-route enrichment selects hand-pick `images` columns with NO `Extract<…,PrivacySensitiveKeys>` compile guard — the un-guarded siblings A15-02 missed. One keystroke (`latitude:`) from a GPS leak; near-identical copy-paste, so a leak must be fixed in both. | `api/search/semantic/route.ts:293-309`, `api/search/similar/[id]/route.ts:195-211` | High | LOW (latent; public surface, high blast radius) |
| A16-02 | Cycle-15 reactions DROP added to `reconcileLegacySchema` has NO regression pin; the DROP tripwire is a hand-maintained allowlist pinning only entitlements/license_tier. A future edit removing the drop passes all tests and re-strands `image_reactions` on legacy/prod DBs. Same class as the cycle-15 headline (fix-without-its-own-lock). | `scripts/migrate.js:636-637` vs `__tests__/migrate-reconcile-coverage.test.ts:190-208` | High | LOW (test-gate hardening) |
| A16-03 | The client→server boundary test is an enumerated denylist that structurally lags new server-only signals (A15-01 proved it). node builtins (`node:fs`/`node:crypto`/`node:net`) are the next uncovered category: 7 server libs import them carrying none of the denylisted markers. | `__tests__/client-server-only-boundary.test.ts:300-307` | High | LOW (latent) |
| — | Layering (gallery-config-shared→gallery-config→image-queue), @/lib/storage quarantine, Symbol.for(globalThis) process-local state, migration column/index/DROP tripwires, field-split module-level guards | various | — | SOUND (positive signal) |

---

## A16-01 — Public search routes bypass the privacy field-split discipline (HEADLINE)

**Architectural risk.** The codebase enforces the public/admin field split with a compile-time guard pattern: every public image-row select literal carries `type _X = Extract<keyof typeof literal, PrivacySensitiveKeys>; const _g: _X extends never ? true : [...] = true`. There are FIVE such guarded literals:
- `publicSelectFields` (`data.ts:395`, guard `:463-464`)
- `publicMapSelectFields` (`data.ts:431`, guard `:475-476`)
- `timelineSelectFields` (`data-timeline.ts:35`, guard `:65-66`)
- `searchFields` (`data.ts:1486`, guard `:1500-1503` — added by A15-02 last cycle)

A15-02 (cycle 15) called `searchFields` "the one public image-row literal with no Extract guard." **That count was wrong.** Two more public image-row select literals exist, and they are on the highest-risk surface in the app — anonymous, per-IP-rate-limited PUBLIC API routes (no `withAdminAuth`, gated only by `preIncrementSemanticAttempt`):

- `apps/web/src/app/api/search/semantic/route.ts:293-309` — the enrichment `db.select({ id, title, description, filename_jpeg, width, height, topic, topic_label, camera_model, lens_model, capture_date })`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:195-211` — a near-identical copy of the same literal.

Neither carries the `Extract<…,PrivacySensitiveKeys>` guard. The author even wrote (`semantic/route.ts:303-306`): *"Both are public … and NOT in `_PrivacySensitiveKeys` (no GPS/PII)"* — proving awareness of the discipline but enforcing it by **hand-checking**, not by a compiler-enforced guard.

**Scenario where it bites (when a new field is added).** A future dev wires a map pin onto the semantic-result card and adds `latitude: images.latitude, longitude: images.longitude` (or `filename_original`, `user_filename`) to the enrichment select. It compiles, `tsc` is clean, every test is green, `lint:public-route-rate-limit` is satisfied — and GPS/PII is now returned in a JSON body to anonymous users. This is the exact A15-02 vector, one sibling over, on a worse surface (A15-02's `searchFields` is reached via a server action with same-origin checks; these are open public GET-style routes). The copy-paste duplication (A16-01b) doubles the hazard: the comments at `similar/route.ts:205-207` and `semantic/route.ts:303-306` show fields had to be mirrored into BOTH by hand ("parity with the semantic route's enrichment") — a privacy regression would likewise have to be caught in both.

**Structural remedy.** Eliminate the bespoke literals: extract ONE shared `searchResultCardFields` const (in `data.ts` or a new `data-search.ts`) carrying the standard `_Sensitive extends never` guard, and import it into both routes — the routes then physically cannot select an unguarded column. Cheaper alternative: a fixture test (mirroring `privacy-fields.test.ts`) that AST-scans every `apps/web/src/app/api/search/**` route's `.select({…})` keys against `PrivacySensitiveKeys`. Either makes the discipline structural instead of memory-dependent. Note the deeper root: `searchFields`' guard is itself FUNCTION-LOCAL (`data.ts:1500`, inside `searchImages`), unlike the four module-level guards — the pattern relies on each author REMEMBERING to add a guard wherever they write an image select, which is precisely what failed here.

**Confidence:** High (read both selects; confirmed public + rate-limited + un-guarded). **Severity:** LOW today (the selected columns are genuinely all public), but the single most valuable structural finding this cycle — it is a zero-signal privacy-leak vector on an anonymous public surface, and it directly falsifies A15-02's own "the one literal" framing.

---

## A16-02 — Cycle-15 reactions DROP landed in reconcile without a regression pin

**Architectural risk.** Migration drift is defended by `migrate-reconcile-coverage.test.ts`, which has three tripwires: column-coverage (every `schema.ts` column named in `migrate.js`), index-coverage (every drizzle `CREATE INDEX` mirrored), and a DROP tripwire. The DROP tripwire is necessary because a dropped table/column vanishes from `schema.ts`, so the column scan can't see it — the only protection a removed element gets is an EXPLICIT pin. That tripwire (`migrate-reconcile-coverage.test.ts:190-208`) pins exactly two drops: `entitlements` and `images.license_tier` (migration 0023).

Cycle 15's Critic-F1 fix (commit `3abeba56`) correctly added the reactions cleanup to reconcile — `scripts/migrate.js:636-637`:
```
await dropTableIfPresent(connection, 'image_reactions');
await dropColumnIfPresent(connection, dbName, 'images', 'reaction_count');
```
…but did NOT extend the DROP tripwire. `grep reaction migrate-reconcile-coverage.test.ts` → 0 hits. The reactions drop has **no regression lock**.

**Scenario where it bites.** A future refactor of `reconcileLegacySchema` (or a careless merge) removes the `image_reactions` drop. Every test stays green; the column/index tripwires don't cover drops; the DROP tripwire doesn't know about reactions. The dead `image_reactions` table + `images.reaction_count NOT NULL DEFAULT 0` silently re-persist on every legacy-migrated DB (including production, which ran `0007_image_reactions.sql`) — the precise condition Critic-F1 set out to eliminate. This is the SAME class the cycle-15 aggregate itself headlined: "the cycle-14 fixes left without their own regression locks" (TE-15-02). The DROP tripwire being a hand-maintained allowlist is the structural root — every removal must be manually mirrored into the test, the identical "fix one sibling, miss the next" hazard.

**Structural remedy.** Minimally, add two pins mirroring lines 191-207 for `image_reactions` / `reaction_count`. Structurally better: replace the hand-pinned DROP list with a generic assertion that walks every `dropTableIfPresent(...)` / `dropColumnIfPresent(...)` call literal in `migrate.js` and asserts each names a real removed element (or maintain a single canonical `REMOVED_SCHEMA_ELEMENTS` array that both `migrate.js` and the test import), so a new drop is covered the moment it is written.

**Confidence:** High (verified both the drop's presence in migrate.js and its absence in the test). **Severity:** LOW (test-gate hardening; the live drop works today).

---

## A16-03 — Boundary test is an enumerated denylist; node builtins are the next uncovered category

**Architectural risk.** `client-server-only-boundary.test.ts` catches a `'use client'` → server-only value-import leak by enumerating known server signals in `reachesServerOnly` (`:300-307`): `import 'server-only'`, `mysql2`, `sharp`, `@huggingface/transformers`, `argon2`, and (A15-01, last cycle) `next/headers` / `next/cache` / `next-intl/server`. This is fundamentally an **allowlist of server signals** — it can only catch leaks through specifiers someone remembered to enumerate. A15-01 already demonstrated the lag (next/* was missing for ~14 cycles). The next category not covered is **Node builtins**: 7 server libraries import `node:fs` / `node:crypto` and carry NONE of the denylisted markers:

`lib/rate-limit.ts`, `lib/settings-hash.ts`, `lib/session.ts`, `lib/serve-upload.ts`, `lib/base56.ts`, `lib/backup-filename.ts`, `lib/storage/local.ts` (verified: each imports a `node:fs`/`node:crypto`/`node:net` form, none matches the denylist regexes).

**Scenario where it bites.** A future `'use client'` module value-imports `@/lib/settings-hash` to reuse `COLOR_IMPACTING_KEYS` / `HASH_LENGTH` (these LOOK like client-safe constants — the most plausible accidental import), pulling `node:crypto` into the client bundle. The boundary test passes GREEN (no enumerated marker in the closure), and the leak surfaces only as an opaque `next build` webpack error — exactly the failure mode A15-01 exists to prevent earlier, just through a different missing entry. `base56.ts` (share-key codec, plausibly wanted client-side) is a second candidate.

**Confidence:** High that the gap exists; LATENT today (all 7 libs are reached only by server files — verified no `'use client'` importer). **Severity:** LOW. **Steelman against acting:** `next build` IS the real safety net here; the boundary test is explicitly only a *fast-loop* earlier-feedback guard, so the cost of the gap is slower feedback, not a shipped bug — which is exactly why it stays LOW. **Structural remedy.** Add node-builtin specifier detection (`node:fs`, `node:crypto`, `node:net`, `node:dns`, `node:child_process`, and bare `fs`/`crypto`) to `reachesServerOnly`, with the same non-vacuous pin style used for the other categories; OR, the durable fix, invert the test from "presence of a known server signal" to "absence of client-safety" so it stops lagging. Calibrate against effort — given A15-01 just patched the same lag one category over, adding node builtins now closes the obvious remaining hole.

---

## Positive signals — architecture that is SOUND and well-fenced

- **Config layering is clean and explicitly documented.** `gallery-config-shared.ts` is pure (constants/types/validators, "NO database imports … safe for client components", verified — no `@/db`). `gallery-config.ts` carries a SERVER-ONLY docstring, imports `@/db`, re-exports the shared surface, and wraps the resolver in React `cache()`. `image-queue.ts` consumes the resolved config and snapshots per-job settings deliberately (the documented per-job snapshot semantics, the reason PERF-15-06 was correctly deferred). The shared→server→queue direction is respected with no back-edges.
- **@/lib/storage quarantine is enforced structurally, not by prose.** `storage-quarantine.test.ts` AST-scans every source file (static, dynamic `import()`, and `import x = require()` forms) and fails if anything outside `lib/storage/` imports it, with a non-vacuous "module exists on disk" check. This is the correct fence for the documented "not yet wired" abstraction.
- **Process-local coordination state is uniform, validated, and fully documented.** All cross-request state uses `Symbol.for('gallerykit.*')` on `globalThis` (`restore-maintenance.ts:1`, `image-queue.ts:75`, `admin-backfill-runner.ts:144`) with runtime shape validation (`image-queue.ts:186-194`). The rate-limit `BoundedMap`s (`rate-limit.ts`, `auth-rate-limit.ts`) and the view-count buffer/retry Maps (`data.ts:17,26`) are the documented per-process buckets. **No NEW undocumented process-local coordination state was introduced** — every instance is already in CLAUDE.md's single-writer caveat list ("Runtime topology"). The scale-out weakening of per-process rate-limit buckets remains accurately documented as BY-DESIGN.
- **Migration parity has three structural tripwires** (column / index / DROP), which is a strong drift defense — A16-02 is a gap WITHIN that defense, not its absence.
- **The field-split has four module-level compile guards** plus the now-guarded `searchFields`; A16-01 is the discipline leaking OUT of `data.ts` into route files, not a defect in the in-`data.ts` enforcement.
- **A15-01/A15-02 fixes verified landed** (`0f03beea`): the boundary test now detects next/* server-runtime imports with a non-vacuous `revalidation.ts` pin, and `searchFields` carries its `_SearchSensitive` guard.

---

## Trade-offs (remedy options for A16-01)

| Option | Pros | Cons |
|--------|------|------|
| Shared guarded `searchResultCardFields` const imported by both routes | Single source of truth; compiler-enforced; removes copy-paste duplication | Small refactor touching two public routes; must keep the shared type's row shape aligned with each route's response mapper |
| Fixture test scanning `api/search/**` `.select({…})` vs PrivacySensitiveKeys | No route refactor; catches any future bespoke select | Adds a third scanning test in the same family; still allows local literals (treats the symptom, leaves the duplication) |
| Leave as-is (hand-checked) | Zero work | Relies on author memory on the highest-risk surface; A15-02 already proved this fails |

---

## References
- `apps/web/src/app/api/search/semantic/route.ts:293-309` — public enrichment select, no privacy guard (A16-01).
- `apps/web/src/app/api/search/similar/[id]/route.ts:195-211` — near-identical un-guarded select (A16-01).
- `apps/web/src/lib/data.ts:1486-1503` — `searchFields` + its function-local `_SearchSensitive` guard (A15-02 reference pattern).
- `apps/web/src/lib/data-timeline.ts:35-66` — `timelineSelectFields` + module-level guard (reference pattern).
- `apps/web/scripts/migrate.js:636-637` — reactions DROP added in cycle 15.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:190-208` — DROP tripwire pinning only entitlements/license_tier; no reactions pin (A16-02).
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:300-307` — `reachesServerOnly` enumerated denylist; node builtins absent (A16-03).
- `apps/web/src/lib/gallery-config-shared.ts:1-6` / `gallery-config.ts:1-12` — clean layering (positive).
- `apps/web/src/__tests__/storage-quarantine.test.ts` — storage quarantine fence (positive).
- `apps/web/src/lib/restore-maintenance.ts:1` / `image-queue.ts:75` / `admin-backfill-runner.ts:144` — Symbol.for globalThis process-local state (positive).
