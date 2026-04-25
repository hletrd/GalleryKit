# Architect — Cycle 3 (review-plan-fix loop, 2026-04-25)

Architecture state: documented constraints (single-node, single-writer, multi-root admin, MySQL advisory locks scoped to MySQL server) hold. CLAUDE.md captures the multi-tenant trap. No new architectural drift detected this cycle.

## Observations

- The two-bucket rate-limit (in-memory + DB) is consistent across all mutating surfaces.
- Topic-route lock and admin-delete lock both use bare advisory-lock names tied to the MySQL server; documented in CLAUDE.md.
- Settings/upload-contract lock correctly serializes upload-shape changes against in-flight uploads.
- Topic-alias validation is the one place where the documented hardening philosophy (block invisible/bidi-override characters in admin-controlled values) is not consistently applied — see SEC-01.

No new architecture-only findings.
