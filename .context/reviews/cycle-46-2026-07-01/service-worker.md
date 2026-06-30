# Cycle 46 Service Worker Review

## Finding: C46-F2

- Severity: Medium
- Confidence: High
- Citations: `apps/web/public/sw.template.js:247`, `apps/web/public/sw.template.js:300`, `apps/web/public/sw.template.js:304`, `apps/web/public/sw.template.js:108`, `apps/web/src/__tests__/sw-template-contract.test.ts:218`

The SW derivative cache has online 404/410 eviction but no offline/failed-probe freshness cap. If the HEAD probe fails, a cached `/uploads/{avif,webp,jpeg}/...` response is returned regardless of age, even though derivative responses are documented as one-hour `must-revalidate`.

Fix: add a timestamp to cached derivative responses, enforce a failed-probe/offline expiry, delete expired cache/meta entries, and pin the generated worker.
