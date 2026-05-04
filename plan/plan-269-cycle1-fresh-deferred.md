# Deferred Items: Cycle 1 Fresh

**Created**: 2026-05-04
**Source**: `_aggregate-c1-fresh.md` review findings

All deferred items from cycle 1 fresh review. See `plan-268-cycle1-fresh-fixes.md` for items scheduled for implementation.

| # | Finding ID | Description | File(s) | Severity | Confidence | Reason | Exit Criterion |
|---|-----------|-------------|---------|----------|------------|--------|----------------|
| 1 | PWF-CRIT-01 | No original-format download for admin | photo-viewer.tsx:222-224 | Med-High | High | New API route + auth needed | Admin download route implemented |
| 2 | PWF-CRIT-02 | Sequential file upload | upload-dropzone.tsx:243-246 | Med-High | High | Architectural change needed | Batch/parallel upload designed |
| 3 | PWF-HIGH-01 | No EXIF-based search/filter | data.ts:1130-1260 | High | High | New search UI + query infra | EXIF search feature designed |
| 4 | PWF-HIGH-02 | No upload processing progress | image-manager.tsx:431-436 | Med-High | High | SSE/WebSocket needed | Real-time status designed |
| 5 | PWF-HIGH-03 | Missing copyright/artist EXIF | process-image.ts, schema.ts | Medium | High | Schema migration + UI | EXIF schema expansion planned |
| 6 | PWF-HIGH-04 | No manual photo ordering | schema.ts, data.ts | Medium | High | Schema migration + UI | Manual ordering feature designed |
| 7 | PWF-HIGH-05 | No bulk download/export | (missing) | Medium | High | New ZIP generation route | Bulk download feature designed |
| 8 | PWF-MED-01 | Shared groups no expiry/password | sharing.ts, schema.ts | Low-Med | High | UI + action changes | Sharing enhancement planned |
| 9 | PWF-MED-02 | No EXIF timezone override | process-image.ts:177-226 | Low-Med | High | New UI needed | Timezone feature designed |
| 10 | PWF-MED-03 | No processing priority | image-queue.ts | Low-Med | Medium | Priority queue + UI | Priority feature designed |
| 11 | PWF-MED-04 | Tag input UX friction | tag-input.tsx | Low-Med | Medium | UX redesign needed | Tag UX redesign planned |
| 12 | PWF-MED-05 | No photo comparison | lightbox.tsx | Low | Medium | Lightbox redesign | Comparison mode designed |
| 13 | PWF-MED-06 | No list/timeline view | home-client.tsx | Low-Med | Medium | New view components | View toggle feature designed |
| 14 | CR-MED-02 | No error boundary | photo-viewer.tsx | Medium | Medium | Fallback UI design needed | Error boundary pattern established |
| 15 | PWF-MED-08 | No watermark option | (missing) | Low | Medium | Processing pipeline change | Watermark feature designed |
| 16 | PWF-LOW-01 | No drag-to-reorder | (missing) | Low | Medium | Depends on DEFER-06 | Alongside manual ordering |
| 17 | PWF-LOW-02 | Map view separate | map/ | Low | Medium | Integration design | Map gallery integration designed |
| 18 | PWF-LOW-03 | "On This Day" not in gallery | home-client.tsx | Low | Medium | UI design | Date discovery designed |
| 19 | PWF-LOW-04 | No rating/label system | (missing) | Low | Medium | New feature | Rating system designed |