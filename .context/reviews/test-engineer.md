# Test Engineer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Test Surface Inventory

35+ test files in `apps/web/src/__tests__/` covering:
- Core libs: blur-data-url, sanitize, backup-filename, base56, tag-slugs, csv-escape, exif-datetime
- Auth: auth-rate-limit, session, auth-rethrow
- Data layer: data-tag-names-sql, data-pagination, privacy-fields
- Image processing: image-queue, image-queue-bootstrap, process-image-blur-wiring, images-action-blur-wiring, images-delete-revalidation
- Upload: upload-dropzone, upload-limits, serve-upload, upload-tracker
- Admin: check-action-origin, check-api-auth, admin-user-create-ordering, auth-rate-limit-ordering
- Security: sql-restore-scan, mysql-cli-ssl, restore-maintenance
- UI: touch-target-audit, lightbox, histogram, upload-dropzone, client-source-contracts
- Settings: settings-image-sizes-lock, gallery-config-shared, seo-actions
- Other: og-rate-limit, live-route, health-route, error-shell, storage-local, queue-shutdown

## Findings (New — Not in Prior Cycles)

### Test Gaps (3)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-TE01 | No test for `deleteImageVariants` with `sizes=[]` (directory scan fallback). The fallback path uses `opendir` + `for await` iteration and `unlink`. A test fixture with a temp directory containing known variant filenames would verify the scan correctly identifies and deletes all matching variants. | `lib/process-image.ts:186-203` | High |
| C3-TE02 | No test for `exportImagesCsv` at any scale. The function builds a CSV string from DB results with GROUP_CONCAT tag aggregation. A mock-based test verifying correct CSV output for a small dataset (5-10 rows with tags) would guard the escapeCsvField integration and the GROUP_CONCAT column ordering. | `app/[locale]/admin/db-actions.ts:51-99` | Medium |
| C3-TE03 | No test for the `loadMoreRateLimit` in `public.ts`. While `searchRateLimit` and `ogRateLimit` have dedicated tests, the load-more rate limit (120 req/min) has no coverage. A unit test verifying the pre-increment + rollback pattern would match the parity of other rate-limit tests. | `app/actions/public.ts:35-74` | Medium |

### INFO (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-TE04 | The `touch-target-audit.test.ts` and `check-action-origin.test.ts` tests use AST-based scanning (not runtime). This is a strong pattern — they catch violations at test time rather than requiring manual review. The pattern could be extended to other architectural invariants (e.g., verifying all API routes use `withAdminAuth`, verifying all public queries use `publicSelectFields`). | `__tests__/touch-target-audit.test.ts`, `__tests__/check-action-origin.test.ts` | Info |

## Verified Test Controls

- Blur data URL contract: producer-side (`process-image-blur-wiring`) + consumer-side (`images-action-blur-wiring`)
- Tag names SQL: `data-tag-names-sql` locks the GROUP_CONCAT shape
- API auth lint: `check-api-auth` scans all API route exports
- Action origin lint: `check-action-origin` scans all mutating server action exports
- Touch target audit: `touch-target-audit` enforces 44px minimum
- Privacy fields: `privacy-fields` verifies public/admin field separation
