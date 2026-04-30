# Architect Review — architect (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Summary

- No new critical, high, or medium findings.
- All prior architectural concerns remain acknowledged as deferred.

## Architectural analysis

### Module Structure
- `lib/data.ts` (~1120 lines): Still a large module containing all data access functions, select field definitions, privacy guards, SEO settings, and view count buffering. The module is well-organized with clear section comments, but its size makes it a cognitive burden for new contributors. Extraction of the view count buffering subsystem and the SEO settings into separate modules would improve navigability.
- Action files are well-scoped: `auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `settings.ts`, `seo.ts`, `public.ts` — each handles a single domain.

### Layering
- Clear separation between data layer (`lib/data.ts`), action layer (`app/actions/`), and UI layer (`components/`).
- Server actions properly validate and sanitize before calling data layer.
- Privacy enforcement at the data layer via `publicSelectFields` / `adminSelectFields` with compile-time guards.

### Coupling
- Advisory lock names are scoped to MySQL server, not database (documented in CLAUDE.md as C8R-RPL-06 / AGG8R-05). Single-instance-per-MySQL-server is the intended deployment.
- Upload processing contract lock couples upload flow to admin settings changes. The lock is appropriate for the single-writer topology.

### Scalability Limits
- Single-writer topology is documented and appropriate for a personal gallery.
- View count buffer, upload tracker, and rate limit maps are all process-local (bounded Maps with eviction).
- `original_file_size: bigint('original_file_size', { mode: 'number' })` uses JS `number` which loses precision for files > 8 PB — safe for practical purposes but noted as deferred C9-F01.

## New Findings

None. The architectural posture is sound for the personal-gallery use case.

## Carry-forward (unchanged — existing deferred backlog)

- ARCH-38-03: `data.ts` is a god module (acknowledged — extraction deferred).
- AGG6R-08: `lib/data.ts` approaching 1200 lines — extraction could improve maintainability.
- C9-F01: `original_file_size` bigint mode `number` precision (LOW — safe for practical file sizes).
