# Verifier — Cycle 2 review-plan-fix loop (2026-04-25)

## Gate evidence

| Gate | Result |
|---|---|
| `npm run lint --workspace=apps/web` | exit 0 |
| `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| `npm test --workspace=apps/web` | 60 files / 402 tests passed (6.32s) |
| `npm run test:e2e --workspace=apps/web` | 20 passed / 1 skipped (37.5s) |
| `npm run build --workspace=apps/web` | exit 0; all routes compiled |

All cycle-2 baseline gates green at HEAD `707ea70`.

## Plan-301 verification

| DOD | Verified |
|---|---|
| 301-A — `humanizeTagLabel` in `photo-title.ts` | Yes, exported and unit-tested |
| 301-A — All four callers consume the helper | **Partial.** `tag-filter.tsx`, `home-client.tsx`, internal `getPhotoDisplayTitle*` callers all use the helper. **`photo-viewer.tsx:395` and `info-bottom-sheet.tsx:243` render `#{tag.name}` raw — DOD violated for the photo-viewer surface.** |
| 301-A — Unit test asserts underscore normalization | Yes (`photo-title.test.ts` lines 65-83, 85-98) |
| 301-B — `useColumnCount` returns 5 at >=1536px | Yes; manual review of source confirms |
| 301-B — 5th masonry card at 2xl gets eager+high | Yes; `home-client.tsx:175` derives from `columnCount` |
| 301-C — `buildHreflangAlternates` extracted, exported, unit-tested | Yes (`locale-path.test.ts:73-95`) |
| 301-C — All three pages emit hreflang | Yes (home, topic, photo) |
| 301-C — Forward-compat: adding new locale auto-extends | **Partial.** `[locale]/layout.tsx:28-34` still has the inline `'en'/'ko'` literal. DOD violated for the root layout surface. |
| 301-D — Two new assertions pass | Yes |

## Conclusion

Plan-301 closed AGG1L-LOW-02 and AGG1L-LOW-12 fully. **AGG1L-LOW-01 and AGG1L-LOW-04 are partially closed**: helpers exist and most consumers were migrated, but two/one surfaces were missed respectively. This produces the cycle-2 LOW findings AGG2L-LOW-01 and AGG2L-LOW-02.
