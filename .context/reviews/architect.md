# Architect Review — Cycle 20 (GalleryKit, HEAD 9af705f4)

**Date:** 2026-06-27
**Scope:** architectural & design risk — coupling, cohesion, layering, module boundaries, leaky abstractions, convention-only invariants, scale/evolution hazards.
**Findings:** 2 NEW (N1, N2) + 6 deferred re-evaluations (A1–A6; A2 now CLOSED) + 1 healthy-boundary note.

## Summary
Cycle-19 closed the top structural root (A2 search-enrichment → its own compile-guarded module). That fix is clean, but it **elevated one hand-maintained list — the `PrivacySensitiveKeys` union — into a cross-module privacy contract now consumed by 5 select surfaces across 3 modules, two of which feed public anonymous routes** (N1). The union is still hand-typed and NOT pinned to the canonical `adminKeys \ publicKeys` split, so it is the new single point whose silent drift weakens every compile guard at once. It is also the cleanest available "make-it-structural" win: a one-line derived type eliminates the list entirely. Separately, `data.ts` (1722 lines) now hosts ≥4 distinct responsibilities and exports a security-critical select-field contract to external leaf modules — the boundary is degrading (N2, reinforces A6). Of the deferred set: A2 CLOSED; A5 fencing materially STRENGTHENED (CI quarantine tripwire); A1/A3/A4/A6 exit criteria all UNMET → still-deferrable.

---

## NEW FINDINGS

### N1 — `PrivacySensitiveKeys` is a hand-maintained union, now the compile-time privacy contract for 5 select surfaces / 3 modules, unpinned to the canonical split — NEW · LOW-MED · High confidence
**Module:** `lib/data.ts:461` (the union) consumed by `lib/data.ts:463` (`publicSelectFields`), `:474` (`publicMapSelectFields`), `:1500` (`searchFields`), `lib/data-timeline.ts:65` (`timelineSelectFields` → PUBLIC `/timeline`, `/year/[year]`, on-this-day widget), `lib/search-enrichment-fields.ts:43` (`searchEnrichmentSelectFields` → PUBLIC `/api/search/semantic`, `/similar/[id]`).

**Design smell.** The A2 fix (commit `50d5603b`) correctly removed the two duplicated route selects and replaced them with one compile-guarded module — but the guard it added (`Extract<keyof …, PrivacySensitiveKeys>`) leans on a union that is hand-typed as a 20-member string-literal list (`data.ts:461`). That union is now imported by THREE modules and guards FIVE select objects. It is the canonical complement of the public split — `Exclude<keyof typeof adminSelectFields, keyof typeof publicSelectFields>` (verified: `publicSelectFields` is built by explicit omit-destructuring of exactly those 20 keys at `data.ts:365-393`) — but nothing computes it that way and nothing pins the literal union to that derivation. There is also a SECOND independent copy of the same 20 keys in `__tests__/privacy-fields.test.ts:6` (`SENSITIVE_KEYS`), and the two are not cross-checked.

**Concrete future-failure scenario.** A future migration adds an admin-only column (say `face_regions`), the author adds it to `adminSelectFields`, omits it from `publicSelectFields`, and adds it to `SENSITIVE_KEYS` (the test list) — but forgets the `PrivacySensitiveKeys` union. The runtime backstops still pass: `privacy-fields` symmetric test and `search-route-privacy` denylist both DERIVE PII from the actual `adminKeys \ publicKeys` keys (R18C18), so they auto-track. But the COMPILE guard the A2 fix was specifically built to provide silently stops protecting `face_regions` on all five surfaces. The timeline surface (`data-timeline.ts`) is the exposed one: a later "show face crops in year-in-review" select that wired `face_regions` into `timelineSelectFields` would compile clean (union doesn't list it) — and `data-timeline.test.ts` is a behavior/truncation test, not a derived-from-actual-keys PII scan, so the timeline surface's tsc-time guard would be its primary protection and it would be a no-op. This is the exact "hand-maintained fan-out, fix one sibling miss the next" root the architect has flagged on A1/A3 — A2 traded two route copies for a now-load-bearing third copy.

**Severity rationale (LOW-MED, not higher):** today the union and both test lists agree (20 keys, verified); the live select objects are still guarded; the public/map/search surfaces retain derived runtime backstops. The exposure is a *silent weakening of the tsc-time guard* under future drift, with the timeline surface least-backstopped.

**Recommended structural action (actionable NOW, low risk):** replace the hand-typed union with a derived type so the contract is structural-by-construction:
```ts
export type PrivacySensitiveKeys =
  Exclude<keyof typeof adminSelectFields, keyof typeof publicSelectFields>;
```
This makes the omit-list in `publicSelectFields` the SINGLE source of truth; all five `Extract<…, PrivacySensitiveKeys>` guards across the three modules then track the canonical split automatically, and the hand-maintained union disappears. It reproduces today's 20 keys exactly (the symmetric test already proves `adminKeys \ publicKeys == SENSITIVE_KEYS`). As a paired tripwire, add one assertion in `privacy-fields.test.ts` that `SENSITIVE_KEYS` equals the runtime `adminSelectFieldKeys \ publicSelectFieldKeys` so the test's own copy can't drift either. **Defer criterion if not now:** implement before the next admin-only column migration, OR the moment a 6th `Extract<…, PrivacySensitiveKeys>` guard site is added.

### N2 — `data.ts` (1722 lines) hosts ≥4 responsibilities and now exports a security-critical select-field contract to external leaf modules — NEW (cohesion/boundary) · MED · High confidence
**Module:** `lib/data.ts` — view-count write-buffer (`:12-242`, the A6 region), the privacy select-field contract (`:244-495`: 5 select objects + 3 compile guards + 3 exported runtime key arrays), the read-query layer (`:497-1690`), and SEO settings (`:1698-1722`).

**Design smell.** `data.ts` is described in-repo as "the data access (read) layer," but it is simultaneously (a) a stateful debounced write-buffer state machine with timers and a SIGTERM drain, (b) the definition site of the cross-module privacy contract, and (c) the read-query layer. Cycle-19's A2 fix established the right pattern by extracting `searchEnrichmentSelectFields` into its own light module *specifically so routes don't transitively pull the 1700-line module* (its own header, `search-enrichment-fields.ts:16-21`, names this). But the larger select-field contract (`adminSelectFields` / `publicSelectFields` / `publicMapSelectFields` / `searchFields`, their guards, and the `PrivacySensitiveKeys` type + `adminSelectFieldKeys`/`publicSelectFieldKeys`/`publicMapSelectFieldKeys` runtime arrays) still lives in `data.ts` and is now imported across the module boundary by `data-timeline.ts` (type) and three test files (runtime arrays). So the security contract is anchored inside the heaviest, most-patched module.

**Concrete change-amplification scenario.** The next privacy-relevant feature (e.g. a new public surface, or N1's derived-union change) forces an edit to `data.ts`'s 250-line select region — the same file that also carries the view-buffer timers and every read query — maximizing merge-conflict surface and review blast-radius for a change that should touch only the privacy contract. Each new public read surface (timeline, map, search-enrichment were three) re-copies the publicSelectFields shape rather than importing one canonical contract, because importing it means importing `data.ts`.

**Recommended structural action.** Extract the select-field contract (the `:244-495` block: select objects, guards, `PrivacySensitiveKeys`, key arrays) into `lib/image-select-fields.ts`, mirroring the `search-enrichment-fields.ts` precedent. `data.ts`, `data-timeline.ts`, and `search-enrichment-fields.ts` then all import the contract from one light module; N1's derived union lands there cleanly. Combined with A6 (extract the view-buffer to `lib/shared-group-view-buffer.ts`), this removes the two non-read responsibilities and returns `data.ts` to ~1200 lines of pure read-query layer. **Defer criterion:** land opportunistically with N1 (they touch the same region), OR when the next public read surface is added (it will want to import the contract, not re-copy it).

---

## DEFERRED-ITEM RE-EVALUATION (exit-criteria check)

### A1 — topics.slug mutable natural key + manual FK fan-out — STILL-DEFERRABLE (exit UNMET)
`db/schema.ts:16` (cascade), `:33` (restrict), `:236` (cascade) — still exactly **3 FK children**, no 4th. None carry `onUpdate:'cascade'`; rename remains a hand re-point inside one tx (`actions/topics.ts`). Exit criterion (4th FK child OR routine user-facing renames) **not met**. The cycle-18 FK-registry test remains the tripwire. No change.

### A2 — search-route enrichment outside the privacy compile-guard — **CLOSED**
Landed cycle-19 (`50d5603b`): `lib/search-enrichment-fields.ts` is a standalone, light module with its OWN `Extract<…, PrivacySensitiveKeys>` compile guard (`:43-47`), type-only union import (no heavy `data.ts` runtime pull), imported by both search routes (`semantic/route.ts:55`, `similar/[id]/route.ts:44`). The runtime denylist was NOT retired but IMPROVED to derive PII from `adminSelectFieldKeys \ publicSelectFieldKeys` (`search-route-privacy.test.ts`), so belt (compile) + braces (derived runtime) both hold. The duplication is gone. Residual: the union it depends on is N1's concern — but the *security* gap A2 named is closed. **Mark closed; carry forward as N1.**

### A3 — upload quota-claim, no single settle point — STILL-DEFERRABLE (exit UNMET)
`actions/images.ts:226-228` claim; **6 hand-placed settles unchanged** (`:244/:249/:273/:277/:542/:564`); outer `try` is finally-only (`:590-592` releases the contract lock, does NOT settle). The only guard remains the invariant comment at `:264-265`. Verified: **no new `await` landed between the claim (:228) and the final settle (:564)** since cycle-19 — the structure is byte-for-byte the same. Exit criterion (new await in that span OR a fresh leak instance) **not met**. The `claimSettled` try/finally restructure remains the correct fix; defer holds. **Re-confirm:** this is a live bug-generator gated only by a comment; it should be the first structural item promoted the moment any edit reopens that span.

### A4 — restore-maintenance flag: correctness-critical process-local state — STILL-DEFERRABLE (exit UNMET)
`lib/restore-maintenance.ts:1-56` unchanged — the flag is a `globalThis`-Symbol per-process boolean (`:7-19`). The `gallerykit_db_restore` advisory lock serializes restores, but the FLAG that 503s mutating actions is per-process; under accidental scale-out, instance B accepts writes against a DB mid-restore → silent corruption. No runtime single-instance fence. The single-web-instance Docker topology (CLAUDE.md) remains the only fence. Exit criterion (any multi-replica deployment contemplated) **not met**. Of all process-local state this is still the only one whose scale-out failure is *correctness*, not analytics/defense — keep it flagged as the mandatory pre-scale-out item.

### A5 — `@/lib/storage` createReadStream lacks public-dir whitelist — STILL-DEFERRABLE, **fencing STRENGTHENED**
`lib/storage/local.ts` unchanged; **zero non-test importers fleet-wide** (re-verified across `src`, `scripts`, `e2e`). Material update vs cycle-19 framing: `__tests__/storage-quarantine.test.ts` (A14-02) is an AST-based CI guard that **fails the build the moment any non-test file imports `@/lib/storage`** (exact or subpath), with a message requiring CLAUDE.md + guard update in the same change. So the exit criterion ("first live importer") is now itself an enforced tripwire — the attractive-nuisance can no longer be wired in silently. The underlying smell (`createReadStream` streams any key incl. `original/`, lacking serve-upload's `ALLOWED_UPLOAD_DIRS` whitelist) is unchanged, but the *path to exposure* is gated. Recommendation downgraded to: prefer deletion (dead + now guarded); if kept, add `ALLOWED_PUBLIC_DIRS` parity when the quarantine test is next touched. Exit **not met**; risk lower than cycle-19 recorded.

### A6 — view-count write-buffer embedded in read-path `data.ts` — STILL-DEFERRABLE (exit UNMET), reinforced by N2
`lib/data.ts:12-242` unchanged — the debounced-flush state machine (mutable `viewCountBuffer` Map swap, backoff retry-count cap, SIGTERM drain, timers at `:33/:59/:95/:180`) still occupies the first 230 lines of the read module. Cohesion-only; no correctness impact; well-tested. Exit criterion (next behavioral change OR a 2nd stateful write-buffer in data.ts) **not met**. N2 makes the same extraction case at module scale — bundle A6's `lib/shared-group-view-buffer.ts` extraction with N2's select-contract extraction when data.ts is next opened structurally.

---

## HEALTHY BOUNDARY (verified, no action)
- **Config resolution layering** (`gallery-config-shared.ts` → `gallery-config.ts` → `image-queue.ts`) is clean: `gallery-config-shared.ts` has NO db imports (explicitly client-safe), `gallery-config.ts` imports validation/parsers FROM shared and adds the db-resolution layer. No inversion; shared never imports config. The client-safe split (`color-pipeline-decisions.ts`, `color-primaries.ts`) is intact.
- **Runtime key exports** (`adminSelectFieldKeys` / `publicSelectFieldKeys` / `publicMapSelectFieldKeys`) are imported only by tests — no route pulls the heavy module via them. (Confirms N2's extraction is low-risk.)

## Root cause (cross-cutting)
A1, A3, the historical author-name leak, and now **N1** share ONE root: a privacy/integrity invariant enforced by a hand-maintained fan-out list (FK children / settle calls / a sensitive-key union) rather than by construction. Cycle-19's A2 fix is the model of the durable answer (one exported guarded const); N1 is the same fix one level up — derive the union so the omit-list is the only place to edit. The recurring lesson: **every cycle that nets a symptom of a hand-maintained list with a test should ask whether the list can be derived instead.**

## Findings ledger
- N1 | LOW-MED | High | NEW | lib/data.ts:461 + data-timeline.ts:65 + search-enrichment-fields.ts:43 — derive `PrivacySensitiveKeys`
- N2 | MED | High | NEW (cohesion/boundary) | lib/data.ts:244-495 — extract `lib/image-select-fields.ts`
- A1 | MED | High | STILL-DEFERRABLE (exit unmet) | db/schema.ts:16,33,236 + actions/topics.ts
- A2 | — | High | **CLOSED** | lib/search-enrichment-fields.ts (→ carry as N1)
- A3 | MED(generator) | High | STILL-DEFERRABLE (exit unmet; no new await) | actions/images.ts:226-592
- A4 | MED(latent) | High | STILL-DEFERRABLE (exit unmet) | lib/restore-maintenance.ts:1-56
- A5 | LOW | Med-High | STILL-DEFERRABLE, fencing strengthened (quarantine CI guard) | lib/storage/local.ts
- A6 | LOW | High | STILL-DEFERRABLE (exit unmet) | lib/data.ts:12-242
