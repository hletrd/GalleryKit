# Cycle 70 Review - Docs and i18n

## Files Reviewed

- `CLAUDE.md`, `README.md`, `apps/web/README.md`
- `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- `apps/web/src/lib/data.ts`, `apps/web/src/lib/caption-generator.ts`
- Settings, semantic search, migration, and i18n parity surfaces.

## Findings

### C70-03 - Auto-alt-text copy still names Florence-2

- Severity/confidence: Low / High.
- File/line: `apps/web/messages/en.json:754`, `apps/web/messages/ko.json:754`.
- Evidence: current code/docs describe EXIF-derived hints and a generic future model-generated description feature. The settings copy still names local Florence-2 inference.
- Failure scenario: operators or future agents infer a model-specific Florence-2 runtime/roadmap expectation that is not current product truth.
- Suggested fix: remove the model-specific reference while keeping the current limitation clear.

### C70-04 - React cache inventory omits `getImageForViewerCached`

- Severity/confidence: Low / High.
- File/line: `CLAUDE.md:409`, `apps/web/src/lib/data.ts:1731`.
- Evidence: `data.ts` exports `getImageForViewerCached`, but the CLAUDE performance section still lists cached wrappers without it and keeps a brittle count.
- Failure scenario: future architecture reviews miss viewer-fetch cache behavior.
- Suggested fix: make the cache inventory countless and include viewer/detail cache coverage.

## Final Sweep

Focused i18n/key and schema/doc tests were reported green by the review lane. These are doc/copy drift fixes only.
