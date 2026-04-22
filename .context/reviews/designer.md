# Cycle 11 Designer Notes

Finding count: 4

### D11-01 — Search overlay loses a strong focus cue and never announces loading/result counts
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/components/search.tsx`, `apps/web/src/components/ui/input.tsx`

### D11-02 — The mobile info sheet only becomes modal after expansion
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/components/info-bottom-sheet.tsx`

### D11-03 — The mobile admin dashboard still relies on a very wide image-manager table
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/components/image-manager.tsx`

### D11-04 — Escape requires two steps after entering lightbox fullscreen
- **Severity:** LOW-MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/components/lightbox.tsx`
