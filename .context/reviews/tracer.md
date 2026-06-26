# Tracer Report — Cycle 13
**Date:** 2026-06-27
**HEAD:** 2a9976a1 (cycle-12 fixes landed; no new commits since _aggregate.md was written)
**Tracer:** Tracer agent (Sonnet 4.6)

---

## Executive Summary

Cycle-12 MEDIUM findings (AGG-R12-01 through AGG-R12-04) are all confirmed in place. No new CRIT or HIGH issues were found. Three new LOW findings are raised — all defense-in-depth gaps in component-level admin gating rather than field-exposure bugs (the data layer correctly omits the fields from public queries). One apparent bug (settings-hash sort asymmetry) is disproved after tracing the full save path.

---

## Trace Report — TRC-13-01

### Observation

`settings-hash.ts:buildHashFromConfig` (line 99) explicitly sorts `imageSizes` before hashing:
```js
image_sizes: [...config.imageSizes].sort((a, b) => a - b).join(','),
```

`settings-hash.ts:fetchHashFromDb` (lines 104-118) reads the raw DB string and passes it directly to `buildHash` with no sorting:
```js
for (const r of rows) map[r.key] = r.value;
return buildHash(map);
```

If the DB stored `image_sizes = '1536,640'` (non-ascending), the two code paths would produce different hashes for the same effective configuration, causing ETag divergence between the normal serve path and the cold-start fallback.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | DB always stores sorted values via normalizeConfiguredImageSizes in the save path; asymmetry is defensive/redundant but not a live bug | High | Strong (Tier 2: primary artifact — settings.ts save path) | Both paths produce identical hashes in all observed DB states |
| 2 | DB can store unsorted image_sizes if another write path bypasses normalization; hash mismatch is latent | Low | Weak (Tier 5: no evidence of bypass path) | No evidence of a bypass path found |

### Evidence For

- Hypothesis 1: `apps/web/src/app/actions/settings.ts:82-91` explicitly calls `normalizeConfiguredImageSizes(requestedImageSizes)` and replaces `sanitizedSettings.image_sizes` with the normalized (sorted, deduped) result before any DB upsert. `normalizeConfiguredImageSizes` at `gallery-config-shared.ts:233` does `Array.from(new Set(parsed)).sort((a, b) => a - b)`, guaranteeing ascending order on every write.
- Hypothesis 1: `gallery-config-shared.ts:217` documents: "Canonicalize an admin-provided image_sizes string into a sorted, deduped list."

### Evidence Against / Gaps

- Hypothesis 1: If a future write path (migration, seed script, direct DB update) bypasses `normalizeConfiguredImageSizes`, the DB would store unsorted values and the two hash paths would diverge. The type system does not prevent this.
- Hypothesis 2: No production write path was found that stores unsorted `image_sizes`.

### Rebuttal Round

- Best challenge to current leader: `fetchHashFromDb` is the cold-start fallback (`serve-upload.ts:69`). If the config resolution fails on cold start AND the DB happens to have non-sorted values from a manual write, the ETag would differ from subsequent requests using `buildHashFromConfig`. No test covers this divergence.
- Why the leader still stands: The save action at `settings.ts:82-91` is the only production write path for `image_sizes`. That path normalizes before saving. The gap exists only for manual DB writes, which are outside the application control boundary.

### Convergence / Separation Notes

Both hypotheses reduce to the same question: does the DB reliably store sorted values? Evidence strongly confirms yes for all in-app write paths. No separation needed.

### Current Best Explanation

The sort in `buildHashFromConfig` is a redundant defensive guard: `config.imageSizes` is already parsed and sorted by `parseConfiguredImageSizes`, and the DB always stores sorted values because the save action normalizes before writing. The `fetchHashFromDb` path produces the same hash. Not a live bug.

### Critical Unknown

Whether a deployment runbook (seed, migration, or manual intervention) could write non-sorted `image_sizes` to the DB and trigger the divergence.

### Discriminating Probe

Add a sort inside `fetchHashFromDb` for the `image_sizes` key, or add a test that feeds a non-sorted raw string (`'1536,640'`) to the no-arg `getColorSettingsHash()` path and asserts it produces the same hash as the config-arg path with the equivalent sorted config. Either change closes the latent gap without affecting observable behavior.

### Uncertainty Notes

Low uncertainty. The sort asymmetry is real at the code level but is neutralized by the normalized DB write path.

---

## Trace Report — TRC-13-02

### Observation

`color-details-section.tsx:393` renders the transfer function text WITHOUT an `isAdmin` guard:

```jsx
{image.transfer_function && (
    <p className="font-medium">
        {humanizeTransferFunction(image.transfer_function, t) || t('viewer.colorUnknown')}
    </p>
)}
```

By contrast, the HDR badge at line 549 correctly uses `{isAdmin && isHdr && ...}`. The inconsistency is a maintenance trap: `transfer_function` is currently admin-only at the data layer, but the render path has no explicit guard to enforce that.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Public component renders transfer_function if and only if image object carries the field; data layer omits it from publicSelectFields, making the unguarded render safe today | High | Strong (Tier 2: data.ts:340 publicSelectFields omit list confirmed) | Verified directly in data.ts |
| 2 | A future change adds transfer_function to publicSelectFields or a new public query uses adminSelectFields; the unguarded render then exposes admin-only data silently | Low | Weak (no evidence this has happened) | Pattern is structurally possible |

### Evidence For

- Hypothesis 1: `apps/web/src/lib/data.ts:340` — `transfer_function: _omitTransferFunction` is in the destructure that builds `publicSelectFields`. The field is `undefined` on every public query result. The `{image.transfer_function && ...}` condition evaluates to false for public callers.
- Hypothesis 1: `apps/web/src/lib/data.ts:424` — `transfer_function` is in the `PrivacySensitiveKeys` type union with a compile-time guard (`_SensitiveKeysInPublic`) that would cause a `tsc` error if `transfer_function` were ever added to `publicSelectFields`.

### Evidence Against / Gaps

- Hypothesis 2: The `_SensitiveKeysInPublic` compile-time guard fires at the data layer, not at the render layer. A component that renders `image.transfer_function` without `isAdmin` would compile and render fine if the field is present in the image object passed to it — for example, an admin context where the `isAdmin` prop is accidentally `false`.
- Gap: The component is used in both public and admin contexts. If a call site passes admin-fetched image data but `isAdmin={false}`, `transfer_function` would render to that viewer with no guard at the component level.

### Rebuttal Round

- Best challenge: The `_SensitiveKeysInPublic` compile-time guard makes the data-layer omission structural. The unguarded render cannot expose data to the public in a correctly-maintained codebase because the compile gate would catch any accidental `publicSelectFields` addition.
- Why the concern remains: The component also serves admin contexts. A call site that passes `isAdmin={false}` to a `ColorDetailsSection` receiving a full admin image object would silently render `transfer_function` to that admin viewer without the component indicating it is an admin-only field. The explicit `isAdmin` guard on the HDR badge (line 549), gain map (line 573), matrix coefficients (line 440), and pipeline decision (line 399) creates a clear precedent that this field block is inconsistent.

### Convergence / Separation Notes

Both hypotheses share the same root observation. They differ in trigger probability: Hypothesis 1 is the current safe state; Hypothesis 2 is the failure mode under a future change. Keeping separate because the mitigations are at different layers.

### Current Best Explanation

Currently safe due to data-layer omission and compile-time guard. The unguarded render at line 393 is a defense-in-depth gap: the render site lacks the explicit `isAdmin` check that all other admin-only field renders in the same component carry.

### Critical Unknown

Whether any current call site constructs a `ColorDetailsSection` with admin-fetched image data but passes `isAdmin={false}`.

### Discriminating Probe

`grep -rn '<ColorDetailsSection' apps/web/src/` — audit every call site for the `isAdmin` prop value and the image query path used. If any call site passes `isAdmin={false}` with an admin-fetched image, TRC-13-02 becomes a confirmed display bug for that context.

### Uncertainty Notes

Severity is LOW. The data layer compile-time guard is the effective protection. The component-level inconsistency is a maintenance smell that should be addressed before `transfer_function` is considered for any public surface.

---

## Trace Report — TRC-13-03

### Observation

`color-details-section.tsx:221` includes `image.is_hdr` in the `hasColorMetadata` derived value without an `isAdmin` check:

```js
const hasColorMetadata = Boolean(
    image.color_primaries || image.transfer_function || image.is_hdr
    || (isAdmin && image.color_pipeline_decision),
);
```

`is_hdr` is in `PrivacySensitiveKeys` and absent from `publicSelectFields`. The unguarded inclusion means a future addition of `is_hdr` to public fields would cause the color-details accordion to auto-open for public visitors of HDR photos, before the HDR badge render (line 549, correctly gated by `isAdmin && isHdr`) was also updated.

### Current Best Explanation

Same structural protection as TRC-13-02. `is_hdr` is never present on public query results (`data.ts:337`: `is_hdr: _omitIsHdr` in publicSelectFields omit). The auto-open trigger never fires for public users. Low severity, same class as TRC-13-02.

The relevant note in CLAUDE.md ("the public HDR badge is now gated on `isAdmin && isHdr` EXPLICITLY at the render point (AGG-M3), not on field-nullness coincidence; locked by `color-details-hdr-badge-admin.test.ts`") refers specifically to the badge element at line 549. The test does not cover the `hasColorMetadata` computed value at line 221, leaving the auto-open behavior unguarded at the component level.

### Critical Unknown

Same as TRC-13-02.

### Discriminating Probe

Change line 221 to include `isAdmin &&` before `image.is_hdr`: `(isAdmin && isHdr)` rather than bare `image.is_hdr`. Extend `color-details-hdr-badge-admin.test.ts` to assert that `hasColorMetadata` is `false` when `isAdmin=false` and `is_hdr=true` (with all other color fields absent). This closes the same gap as the badge test covers for the badge element, for the accordion-open state.

### Uncertainty Notes

Severity is LOW. Same data-layer guard as TRC-13-02.

---

## Trace Report — TRC-13-04

### Observation

`apps/web/src/lib/request-origin.ts:109` exports the internal `hasTrustedSameOriginWithOptions` function:

```js
export { hasTrustedSameOriginWithOptions };
```

This function accepts an `{ allowMissingSource: true }` option that makes the same-origin check pass even when the request carries neither `Origin` nor `Referer` header (normally a fail-closed rejection per the comment at line 87: "Fail closed by default (C1R-01)"). The public API `hasTrustedSameOrigin` delegates to this function with default options (no `allowMissingSource`), preserving fail-closed behavior.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Export is present for test coverage only; no production code calls it with allowMissingSource; no security risk in current code | High | Strong (Tier 2: grep confirmed zero non-test callers) | Verified by codebase search |
| 2 | A future server action or route handler imports hasTrustedSameOriginWithOptions directly with allowMissingSource: true, bypassing CSRF protection | Low | Weak (Tier 5: no evidence) | Export makes the escape hatch discoverable |

### Evidence For

- Hypothesis 1: `grep -rn "hasTrustedSameOriginWithOptions"` outside test and the origin file finds only a comment reference in `apps/web/src/app/api/admin/db/download/route.ts:13` (no call, just a comment noting the prior inline check was replaced). No production call site uses the `allowMissingSource` option.
- Hypothesis 1: The function is callable only from server-side code. It is not accessible to external HTTP clients.

### Evidence Against / Gaps

- Hypothesis 2: The export makes the `allowMissingSource` escape hatch a documented API surface. A developer looking for a same-origin check might import `hasTrustedSameOriginWithOptions` directly and misuse the option without realizing it bypasses CSRF protection.

### Rebuttal Round

- Best challenge: The `action-origin` lint gate (`npm run lint:action-origin`) requires every mutating server action to call `requireSameOriginAdmin()` and return early on its result. That function internally calls `hasTrustedSameOrigin` (the safe, fail-closed form), not `hasTrustedSameOriginWithOptions`. The lint gate enforces the correct call site, so new server actions cannot accidentally use the wrong function and pass the lint gate.
- Why the concern remains: The lint gate covers `apps/web/src/app/actions/` only. Admin API route handlers use `withAdminAuth()`. A custom route outside these patterns would not be caught by either gate.

### Current Best Explanation

No active security issue. The export is a minor encapsulation gap. Making `hasTrustedSameOriginWithOptions` unexported (or renaming it `_hasTrustedSameOriginWithOptionsForTesting`) would eliminate the surface without any behavior change.

### Critical Unknown

Whether the `allowMissingSource: true` path is ever needed in production (e.g., for a non-browser caller that cannot supply an Origin header, such as the Lightroom Classic plugin). If so, the export is intentional.

### Discriminating Probe

Search the codebase for any route or action file that might need to serve non-browser clients (the Lightroom Classic upload route `/api/admin/lr/upload` is a candidate). If `allowMissingSource: true` is needed there, document it explicitly. If not, unexport the function and update the test import.

### Uncertainty Notes

Severity is LOW. No current misuse exists.

---

## Trace Report — TRC-13-05 (Deferred Items — Resolution)

### AGG-R12-08: stale comment in image-queue.ts line 87

**Verdict: NOT a bug.** The docstring for `pruneRetryMaps` at line 87 says "insertion-order via Map.keys() iteration." This accurately describes what the function does: it iterates `state.retryCounts`, `state.claimRetryCounts`, and `state.lastErrors`, all of which are Maps. `permanentlyFailedIds` is a Set but is NOT touched by `pruneRetryMaps`; its FIFO eviction is a separate code path at lines 566-570 using `Set.values().next()`. The comment is correct for the function it documents. No fix needed.

### AGG-R12-09: hasTrustedSameOriginWithOptions exported (deferred LOW)

**Status: Still present.** Documented in detail as TRC-13-04 above. Zero non-test callers with unsafe option confirmed.

### AGG-R12-10: BoundedMap.entries() raw iterator (deferred LOW)

**Verdict: No active risk.** `BoundedMap.entries()` at `bounded-map.ts:116` returns `this.map.entries()` (a live iterator). A full codebase grep finds zero non-test callers of `.entries()` on any `BoundedMap` instance in production code. The method exists but is never invoked. The mutation-during-iteration concern is theoretical with zero exposure.

---

## Cycle-12 Fix Verification

All four AGG-R12 MEDIUM fixes are confirmed in the current codebase:

| Finding | File:lines | Evidence |
|---------|------------|----------|
| AGG-R12-01: shutdown timer clearTimeout + unref + process.exit | instrumentation.ts:25,31,51,65 | `let shutdownTimer: ReturnType<typeof setTimeout> \| undefined`; `shutdownTimer.unref?..()`; `finally { if (shutdownTimer) clearTimeout(shutdownTimer); }`; `process.exit(exitCode)` |
| AGG-R12-02: AVIF 4096-byte partial read (not full file) | process-image.ts:240-265 | `Buffer.alloc(4096)`; `handle.read(head, 0, 4096, 0)` inside `_verifyAvifNclx` |
| AGG-R12-03: CLAUDE.md documentation | CLAUDE.md | Shutdown + geoip-lite pre-warm section present |
| AGG-R12-04: DB init timer clearTimeout + unref + stale promise clear | db/index.ts:94-111 | `let initTimer: ReturnType<typeof setTimeout> \| undefined`; `initTimer.unref?..()`; `finally { if (initTimer) clearTimeout(initTimer); }`; `underlying[connectionInitSymbol] = undefined` on timeout |

Additional cycle-12 hardening confirmed in current code:

- Queue shape guard: `image-queue.ts:186-196` — truthy + `typeof existing.queue.add === 'function'` + `existing.enqueued instanceof Set`
- Delete-during-processing cleanup: `image-queue.ts:437-453` — `deleteImageVariants(dir, filename, [])` on `affectedRows === 0` for all three formats with empty sizes array (full directory scan, catches non-default-size variants)
- Backfill version-bump-only-on-success: `admin-backfill-runner.ts:597-612` — detection-failure path leaves `pipeline_version` below current, row remains eligible for retry on next run
- HDR badge double-gated: `color-details-section.tsx:549` — `{isAdmin && isHdr && ...}` (render gate) on top of data-layer omission of `is_hdr` from `publicSelectFields`

---

## Overall Cycle-13 Finding Summary

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| TRC-13-01 | DISPROVED | settings-hash.ts | Sort asymmetry between buildHashFromConfig and fetchHashFromDb for image_sizes — neutralized by normalized DB write path in settings.ts:82-91 | No fix needed |
| TRC-13-02 | LOW | color-details-section.tsx:393 | `{image.transfer_function && ...}` renders without isAdmin guard — safe today (data layer omits field), maintenance trap | Recommend: wrap with `isAdmin &&` |
| TRC-13-03 | LOW | color-details-section.tsx:221 | `image.is_hdr` in `hasColorMetadata` without isAdmin — safe today, accordion would auto-open publicly if is_hdr ever enters publicSelectFields | Recommend: `(isAdmin && isHdr)` in place of bare `image.is_hdr` |
| TRC-13-04 | LOW | request-origin.ts:109 | `hasTrustedSameOriginWithOptions` exported; exposes `allowMissingSource: true` escape hatch as public API | Recommend: unexport or rename with `_testOnly` prefix |
| TRC-13-05 | INFORMATIONAL | bounded-map.ts:116 | `BoundedMap.entries()` returns live iterator — zero production callers, no active risk | Monitor only |

**Net cycle-13 result: 0 CRIT, 0 HIGH, 3 LOW (TRC-13-02, TRC-13-03, TRC-13-04), 1 INFORMATIONAL.**

The codebase is in clean state following cycle-12. The three LOW findings are component-level defense-in-depth gaps where the data layer provides structural protection but the render layer lacks explicit admin gating on admin-only fields, inconsistent with the explicit guards on adjacent admin-only fields in the same component.
