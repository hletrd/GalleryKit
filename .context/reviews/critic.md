# Cycle 11 Critic Notes

Finding count: 4

## Findings

### K11-01 — Share throttling over-charges idempotent copy-again flows
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/actions/sharing.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx`
- Existing photo share keys were returned only after burning rate-limit budget, and the in-memory limiter was coupled across share types.

### K11-02 — Topic aliases can bypass locale middleware when they contain dots
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/validation.ts`, `apps/web/src/proxy.ts`
- Dotted aliases are accepted by validation even though locale middleware skips dotted pathnames as asset-like requests.

### K11-03 — Restore maintenance can strand uploads in `processed = false`
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`
- Uploads inserted during a restore window can miss queue replay until process restart.

### K11-04 — Storage backend switching still overstates live pipeline support
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/serve-upload.ts`
- The switchable backend API still looks more production-ready than the live upload/serve pipeline actually is.
