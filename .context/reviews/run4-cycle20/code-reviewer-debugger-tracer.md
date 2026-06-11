# Code-reviewer / Debugger / Tracer — Run-4 Cycle 20

Single-subagent in-context pass (see security angle for the constraint note).

## Inventory (this angle)

Line-level read of the cycle-19 fix surfaces plus the cycle-20 rotation
cluster (URL/redirect/validation). Additionally swept the small client-safe
`lib/*` leaf utilities not touched since their introduction:
`backup-filename.ts`, `download-filename.ts`, `exif-datetime.ts`,
`tag-slugs.ts`, `tag-records.ts`, `upload-filenames.ts`, `base56.ts`,
`bounded-map.ts`, `clipboard.ts`, `safe-json-ld.ts`, `revalidation.ts`,
`csp-nonce.ts`, `feature-flags.ts`, `analytics-data.ts`.

## Findings

### Concur with SEC-R4C20-01 (validateSeoOgImageUrl backslash bypass)

Traced from the validator (`seo-og-url.ts:9`) forward to both consumers
(og:image meta on 3 public pages, and the 302 `Location` header in
`og/photo/[id]/route.tsx:255`). The 302 path is the sharper of the two:
`buildFallbackResponse` copies `ogImageUrl` verbatim into `Location`, so a
backslash value yields an open redirect. Single chokepoint = the
write-time validator; fixing it closes both consumers. Code-quality view:
the fix belongs in the validator, not at each consumer, to keep the
same-origin policy in one place (matches the C2R-02 `requireSameOriginAdmin`
centralization philosophy). Confidence High.

## Clean-pass leaf utilities (no findings)

- `backup-filename.ts`: anchored `^…$` pattern, `[:.]→-` timestamp
  normalization is lossless for filename use; suffix is a UUID slice.
- `download-filename.ts`: strips UNICODE_FORMAT_CHARS + C0/C1 + NFKD
  diacritics, collapses to `[a-z0-9-]`, caps 60 chars, falls back to
  `photo-{id}` on empty slug. No path-separator or traversal leak.
- `exif-datetime.ts`: strict regex + UTC round-trip rejects e.g. Feb-30.
- `tag-slugs.ts` / `tag-records.ts`: dedupe + bounded count (20) + slug
  collision discrimination (`found`/`collision`/`missing`) is sound.
- `base56.ts`: rejection sampling at `>=224` removes modulo bias correctly
  (224 = 56*4); 1000-attempt circuit breaker; pool refill on exhaustion.
- `bounded-map.ts`: collect-then-delete prune + insertion-order eviction;
  no iterator-invalidation hazard.
- `analytics-data.ts`: `orderBy(desc(sql\`viewCount\`))` references the
  select alias — valid MySQL (ORDER BY may use SELECT aliases) and the
  established Drizzle pattern across all five analytics queries; bot rows
  excluded via `eq(*.bot,false)`. No finding.
- `safe-json-ld.ts`: escapes `<`, U+2028, U+2029 — covers the `</script>`
  break-out and legacy line-terminator hazards.

## Dormant items carried from prior cycles (re-confirmed, no change)

- OBS-R4C19-B (check-api-auth.ts:162 bare `require.main`) — dormant under
  tsx CJS; no functional edit landed on that file this cycle. Carried.
- OBS-R4C19-D (migrate-capture-date.js trailing `Z`) — dormant (DATETIME
  columns; `:40` early-return). Carried.
