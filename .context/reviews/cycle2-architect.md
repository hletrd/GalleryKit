# Cycle 2 — Architect Findings

**Date**: 2026-05-05
**Scope**: Architectural/design risks, coupling, layering
**Method**: Review module boundaries, dependency graph, coupling

---

## Architecture Review

### Layering
- **Presentation** (`components/`) — React components, client/server separation clear.
- **API** (`app/api/`) — Route handlers, auth wrappers, rate limits.
- **Actions** (`app/actions/`) — Server actions with same-origin guards.
- **Data** (`lib/data.ts`) — Drizzle ORM queries, privacy field sets.
- **Domain** (`lib/process-image.ts`, `lib/photo-title.ts`, etc.) — Business logic.
- **Infrastructure** (`lib/upload-paths.ts`, `lib/image-queue.ts`) — File system, queue.

### Coupling Analysis
- `data.ts` is the central query hub. Uses `cache()` for SSR deduplication. Acceptable coupling — it's a data access layer.
- `process-image.ts` depends only on Sharp and file system. No DB coupling.
- `upload-paths.ts` isolates path constants. Good separation.
- `validation.ts` and `sanitize.ts` are shared utilities with no outbound deps. Good.

### Risks Reviewed
- **Horizontal scaling**: CLAUDE.md explicitly notes single-instance topology. Advisory locks are MySQL-server-scoped. Documented risk, not a new finding.
- **Image queue**: PQueue with process-local state. Documented limitation.
- **View count buffer**: In-memory Map with best-effort flush. Documented limitation.
- **Upload tracker**: In-memory Map. Documented limitation.

---

## Findings

**0 new architectural findings.**

The architecture is well-layered with clear boundaries. No new coupling risks or layering violations identified.

**Conclusion**: No architectural issues found in this cycle.
