# Architect — Cycle 6 Provenance

Review target: `6e4c25c8`. The inventory covered App Router surfaces, data/lib/component ownership, schema/migration/reconcile, scripts/jobs, tests, runtime/build/deploy/PWA assets, and governing/current/deferred documentation. I traced config lifetime, persistence, concurrency, privacy, cache, and image-delivery ownership.

## NEW Cycle 6 finding

### ARCH-C6-01 — Responsive masonry now has aligned source policy but divergent geometry policy

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed live geometry mismatch; visible relayout manual-validation**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-42`; `apps/web/src/components/home-client.tsx:27-79,231-274`; `apps/web/src/components/masonry-card.tsx:52-77`

The new helper makes source sizes item-count-aware, but effective columns still have three owners: raw viewport count in `useColumnCount`, item-capped Tailwind classes in `HomeClient`, and sizes in `responsive-masonry.ts`. Production demonstrated the consequence: a two-column 744 px card received a five-column-derived 196 px intrinsic-height hint instead of its 496 px rendered height.

Concrete failure: an offscreen sparse grid can reserve the wrong document extent and relayout when activated. More broadly, a future breakpoint change can update one owner while the other two remain internally plausible.

Fix: introduce one client-safe responsive masonry policy that returns breakpoint maximum, item-capped effective columns, source-size value, and approved class token; use container observation for width where possible. Timeline/year/shared grids should consume the same named policy variants.

## Revalidated carry-forward

Cycle 5's `ARCH-C5-01` is only partially closed: responsive size literals are centralized, but layout and size ownership are not. That residual is explicitly carry-forward context; `ARCH-C6-01` is the newly confirmed sibling failure, not a relabeling. Shared background DB admission, warn-only single-instance enforcement, DB/file restore generation, and rollback remain existing architecture risks with unchanged exit criteria.

## Final architecture sweep and coverage

I rechecked persistence mounts, build/runtime config ownership, schema/journal/reconcile, writers versus restore fences, file lifecycle, process-local coordination, caches, color/semantic delivery, image fallback, release promotion, and governing docs. No further fresh architectural break survived.
