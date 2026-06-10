# Test-engineer angle — Run-4 Cycle 9

Inventory: full read of `__tests__/strip-gps-from-original.test.ts`
(257 lines, 16 cases) against the scrubber's branch surface; survey of
the R4C8 contract suites (avif-probe-data-url, neighbor-preload,
picture-fallback, icc-options-lockin additions); privacy fixture
coverage audit for the timeline module; baseline run.

Baseline (clean tree): vitest 1729/1729 PASS across 181 files;
typecheck PASS.

## TEST-R4C9-04 — data-timeline privacy contract has zero enforcement

**Severity gap (MED for the guarded property) / Confidence High.**

`lib/data-timeline.ts:22-49` hand-mirrors `publicSelectFields` with
only a comment ("Do NOT add PII fields here"). Unlike data.ts — which
has BOTH a compile-time `_PrivacySensitiveKeys` guard and the
`privacy-fields.test.ts` fixture — the timeline module has neither:
`grep timelineSelectFields __tests__/` is empty, and there is no
`Extract<keyof …>` guard in the module. The timeline rows flow to
PUBLIC pages (/timeline, year-in-review, OnThisDay on home). A future
column addition (someone adds `latitude` for a "photo map of the
day") type-checks clean and leaks silently.

Fix: (a) add the same compile-time guard pattern to data-timeline.ts
(`type _TimelineSensitive = Extract<keyof typeof timelineSelectFields,
_PrivacySensitiveKeys-equivalent>` asserted `never`); (b) extend
`privacy-fields.test.ts` (or a sibling fixture test) to pin
`timelineSelectFields` ∩ SENSITIVE_KEYS = ∅ so the runtime fixture
list and the type guard can't drift apart.

## TEST-R4C9-05 — GPS-strip suite cannot detect the ExtendedXMP gap (folds into SEC-R4C9-01 fix)

**Severity gap / Confidence High.**

Every XMP case in `strip-gps-from-original.test.ts` ("drops
GPS-bearing XMP APP1 segments", line 189) places the GPS markers in
the STANDARD packet. There is no fixture where the standard packet
carries only `HasExtendedXMP` and the coordinates live in
`http://ns.adobe.com/xmp/extension/` segments — exactly the shape
proven leaky this cycle. The fix must land with: (1) ext-only-GPS
JPEG → stripped=true, output free of GPS tokens AND of all XMP APP1
segments; (2) std-GPS case still passes (no regression); (3) a
GPS-free ext-XMP JPEG stays byte-identical (`stripped:false`,
same-reference contract preserved).

## Coverage assessment of R4C8 suites (no action needed)

- `avif-probe-data-url.test.ts` round-trips the actual literal through
  sharp metadata + raw decode — locks probe validity at the byte
  level. Good pattern.
- `neighbor-preload-contract.test.ts` and
  `picture-fallback-contract.test.ts` are source-contract pins
  (regex over component source). Brittle by design but appropriate
  for "shape must not silently revert" guarantees; they reference
  current line shapes that this cycle's fixes must not break.
- `strip-gps-from-original.test.ts` exercises REAL sharp-generated
  files per container (JPEG/AVIF/WebP/TIFF/PNG) including the
  pixel-byte-identity assertions — strong behavioral base; only the
  ExtendedXMP dimension is missing (above).

## Flake watch

152 s vitest wall time, no retries observed; the strip-gps suite
writes temp files under os.tmpdir with per-test UUIDs (no shared-state
hazard). E2E to be run in PROMPT 3 as the gate.
