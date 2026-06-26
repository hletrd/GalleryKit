# Architect Review — GalleryKit Cycle 15 (HEAD 2f886351)

**Agent:** architect (opus) · **Angle:** coupling/layering, client/server boundary, public/admin field-omission seam, config drift, invariant-guard completeness.

**One-line summary:** Structure is sound and well-hardened; no CRIT/HIGH/MED architectural debt beyond the already-deferred set. The only new signal is a cluster of **three latent guard-gaps** where a correctness invariant is enforced by an *enumeration* (boundary-test signal list, per-field-set privacy guards, a Dockerfile ENV) that a future change can silently step outside — same structural class as "fix one sibling, miss the next."

## ACTIONABLE-NOW

### A15-01 — Client→server-only boundary test is blind to Next's server-runtime modules — HIGH conf, LOW sev (latent)
**Module:** `__tests__/client-server-only-boundary.test.ts` (`reachesServerOnly`, `hasNativeModuleImport`, `hasServerOnlyDriverImport`). The test detects a server-only module in a `'use client'` closure by an enumerated denylist (`server-only`, `mysql2`, `sharp`, `@huggingface/transformers`, `argon2`) but does NOT recognize `next/headers`, `next/cache`, `next-intl/server` — yet importing any of those in a client bundle fails at build, exactly like `server-only`. Three real lib modules sit entirely outside the net: `lib/revalidation.ts:1` (`next/cache`), `lib/csp-nonce.ts:1` (`next/headers`), `lib/action-guards.ts:1-2` (`next/headers` + `next-intl/server`). A future `'use client'` value-import of any of these passes the boundary test GREEN and breaks only as an opaque `next build` error — the exact bug the test exists for. Latent (no client value-importer today). The argon2-added-in-cycle-14-because-missed history proves the enumeration is structurally incomplete.
**Fix (cheap):** add a `hasNextServerRuntimeImport` clause matching `next/headers`, `next/cache`, `next-intl/server`; pin with a non-vacuous test (e.g. `revalidation.ts` is server-only-equivalent).

### A15-02 — `searchFields` is the one public image-row field-set with no compile-time privacy guard — HIGH conf, LOW sev
**Module:** `data.ts:1481` (`searchFields`), wired to anonymous public `searchImagesAction` (`public.ts:294`). Every other image-row select set is guarded (`publicSelectFields`/`publicMapSelectFields` derive-by-omission + `Extract<…,PrivacySensitiveKeys> extends never` guards; `timelineSelectFields` likewise). `searchFields` is a hand-written literal with no guard. Clean today (no PII columns), but it's the kind of literal a "search by GPS / show ISO" feature would extend directly — a PII column landing there has zero compile/test signal.
**Fix (cheap, ~3 lines):** add `type _SearchSensitive = Extract<keyof typeof searchFields, PrivacySensitiveKeys>;` + the `extends never` guard, mirroring the timeline guard.

### A15-03 — Graceful-shutdown correctness hinges on a Dockerfile-only ENV with no guard — MEDIUM conf, LOW sev
**Modules:** `Dockerfile:103` (`ENV NEXT_MANUAL_SIG_HANDLE=true`) ↔ `instrumentation.ts:72`. The cycle-14 fix lives entirely in one Dockerfile ENV line; the app cannot set it (Next reads it at boot before `register()`). The invariant "this must be set or graceful shutdown silently breaks" is invisible to code and untested. A future k8s/Helm manifest or non-Docker `next start` reintroduces the exact race just fixed.
**Fix (cheap, borderline by-design):** a fixture test asserting `Dockerfile` contains `NEXT_MANUAL_SIG_HANDLE=true` (matches existing pin style: sw-template-contract, nginx body-size assertions).

## VERIFIED-CLEAN (checked this cycle)
- COLOR_IMPACTING_KEYS complete (9 keys; `strip_gps_on_upload` correctly excluded — scrubs original only; non-byte settings excluded). `_ColorKeysAreSettingKeys` guard holds.
- Public/admin field-omission seam airtight (3 compile-time guards + frozen-key runtime fixtures), except `searchFields` (A15-02).
- Config layering clean + unidirectional (`gallery-config-shared` → `gallery-config` → `image-queue`; no back-edges).
- Migration monotonicity holds (idx 18-23 strictly ascending, max `1782000000000`; a `Date.now()`-stamped entry advances).
- Shutdown coordination: single registry, Next's competing handler neutralized, drain+flush in one bounded 15s `Promise.race`; `flushGroupViewCounts` is a self-contained module-local state machine — no new cross-module coupling.

## BY-DESIGN / DEFERRED (re-confirmed)
God-modules (`data.ts` 1705 lines, `process-image.ts`, `uploadImages`); `lib/storage/` quarantine (now defended by cycle-14 `storage-quarantine.test.ts`); single-web-instance process-local state (advisory-lock-fenced where it matters); shutdown-hook registry consolidation; view-buffer extraction; per-process rate-limit buckets weakening under scale-out — all documented BY-DESIGN/deferred.

**Net:** a mature, well-defended structure. The three actionable findings are all LOW-severity guard-hardening on invariants that are correct today but enforced by enumerations a future edit can step around — each fixable in a few lines, each matching an existing repo pattern.
