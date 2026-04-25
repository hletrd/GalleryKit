# Tracer Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

## Trace path: tag name input → DB → render

1. Admin POSTs tag name in `addTagToImage` / `updateTag` / `batchAddTags` / `batchUpdateImageTags`.
2. `stripControlChars` applied (`\x00-\x1F`, `\x7F-\x9F`); ASCII control chars stripped, but **U+200B/U+202E/U+2066/U+FEFF survive** (high codepoints not in the regex).
3. `isValidTagName` validates length, comma, HTML-special chars — but not Unicode bidi/invisible.
4. `getTagSlug` derives slug via `[^\p{Letter}\p{Number}-]+` regex which strips the formatting chars: slug is safe.
5. **Name persists with formatting chars intact** in `tags.name` (varchar 255).
6. Admin UI (`/admin/tags`) renders the name in tables; image-pill chips on photo cards render the name.

CSV consumer is hardened (C7R-RPL-11 / C8R-RPL-01). UI rendering is not — this is the gap.

## Cross-references

- C4L-SEC-01 confirmed.
- C3L-SEC-01 closed the parallel `isValidTopicAlias` path — same hardening posture should apply.

## Confidence

- High that the gap exists; Medium that the practical risk is low (admin-only input, low blast radius). Net: defense-in-depth fix worth landing.
