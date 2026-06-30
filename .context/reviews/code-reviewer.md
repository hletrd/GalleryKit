# Cycle 27 Code Review

Reviewer: cycle-27 code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `50dfcda0895c2af563836a71d656fbf9ae2048c9`
Date: 2026-06-30 KST

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-26-2026-06-30-deferred.md`, prior `.context/reviews/code-reviewer.md`, and archived cycle-27 aggregate/deferred notes.

Tracked review-relevant inventory:

| Area | Count |
| --- | ---: |
| App Router/API/actions | 77 |
| Components | 58 |
| Shared/domain/runtime libs | 98 |
| DB schema | 3 |
| Unit/source-contract tests | 276 |
| E2E tests | 8 |
| Scripts | 28 |
| Drizzle migrations/meta | 31 |
| Current/archived reviews | 1678 |
| Plans | 97 |
| Docs | 2 |

Reviewed categories: admin/public server actions, admin API wrappers, public API routes, restore/backup flow, SQL restore scanner, restore lifecycle/recovery script, upload/LR upload and queue coordination, data-layer privacy selects, schema/migration journal, modal/focus helpers, representative public/admin page interactions, and current tests around the touched areas. I also inspected the delta since the previous reviewed HEAD `d13d6637..50dfcda0`.

Known deferred items from cycle 26 were not duplicated: public error shell UX, approximate analytics restore-boundary work, exact public listing totals, upload lock span, GPS-strip memory, masonry/map/CSV/timeline/nav/SW performance items.

## Confirmed Issues

### C27-CODE-MED-01 - Restore scanner still accepts MySQL INSERT forms that bypass the cross-schema target check

Severity: Medium  
Confidence: High  
Regions:

- `apps/web/src/lib/sql-restore-scan.ts:40-53`
- `apps/web/src/lib/sql-restore-scan.ts:190-206`
- `apps/web/src/app/[locale]/admin/db-actions.ts:623-647`
- `apps/web/src/__tests__/sql-restore-scan.test.ts:53-95`

Problem:
The restore scanner added a write-target allowlist, but `SQL_WRITE_TARGET_PATTERN` only recognizes `INSERT` when it is immediately followed by optional `IGNORE` and then `INTO`. MySQL also accepts `INSERT HIGH_PRIORITY INTO ...`, `INSERT LOW_PRIORITY INTO ...`, `INSERT DELAYED INTO ...`, and `INSERT tbl_name ...` without `INTO`. Those forms skip `hasDisallowedRestoreWriteTarget()` entirely, and the denylist does not treat `INSERT` as dangerous.

I verified the current helper returns `false` for all of these:

- `INSERT HIGH_PRIORITY INTO otherdb.images VALUES (1);`
- `INSERT LOW_PRIORITY INTO otherdb.images VALUES (1);`
- `INSERT DELAYED INTO otherdb.images VALUES (1);`
- `INSERT otherdb.images VALUES (1);`

Concrete failure scenario:
An admin or compromised admin session uploads a crafted restore file. The scanner passes it at `db-actions.ts:623-647`, then `mysql --one-database` imports it. On an overprivileged/co-hosted MySQL account, a statement like `INSERT HIGH_PRIORITY INTO otherdb.images VALUES (...)` can write outside the GalleryKit schema despite the intended cross-schema block. This is the same trust boundary the cycle-26 scanner fix was meant to close, but the grammar coverage is incomplete.

Suggested fix:
Replace the single broad regex with a small token scanner for DDL/DML statement heads, or expand the grammar to cover MySQL's legal modifiers:

- `INSERT [LOW_PRIORITY | DELAYED | HIGH_PRIORITY] [IGNORE] [INTO] target`
- `REPLACE [LOW_PRIORITY | DELAYED] [INTO] target`
- `CREATE [TEMPORARY] TABLE ...` with temporary tables rejected unless there is a documented restore need

Add regression tests for every accepted MySQL spelling above, especially schema-qualified targets with modifiers and no `INTO`.

### C27-CODE-MED-02 - Restore scanner allows temporary app-table creates that can shadow restored data

Severity: Medium  
Confidence: Medium-High  
Regions:

- `apps/web/src/lib/sql-restore-scan.ts:42-45`
- `apps/web/src/lib/sql-restore-scan.ts:200-206`
- `apps/web/src/__tests__/sql-restore-scan.test.ts:31-51`

Problem:
`CREATE TEMPORARY TABLE` is explicitly included in the allowed write-target grammar, and the allowlist then accepts it when the table name is one of `APP_BACKUP_TABLES`. The app's own backup shape does not need temporary app tables. The current tests even allow `DROP TEMPORARY TABLE images`, but there is no test that rejects `CREATE TEMPORARY TABLE images`.

Concrete failure scenario:
A crafted restore file contains:

```sql
DROP TABLE IF EXISTS `images`;
CREATE TEMPORARY TABLE `images` (...);
INSERT INTO `images` VALUES (...);
```

The scanner allows the known app table target. During the mysql session, inserts can go to the temporary `images` table, then vanish when the session exits. Depending on the exact dump shape and migration baseline state, post-restore reconciliation may either recreate an empty permanent table or leave the operator in a failed-restore recovery flow, but the restore scanner should not admit this non-mysqldump shape in the first place.

Suggested fix:
Reject `CREATE TEMPORARY TABLE` and `DROP TEMPORARY TABLE` in restore files unless a future backup path intentionally emits them. App-generated `mysqldump` table resets are ordinary `DROP TABLE IF EXISTS` plus permanent `CREATE TABLE`; keep the allowlist that narrow. Add tests asserting `containsDangerousSql('CREATE TEMPORARY TABLE images (...)') === true`.

## Likely Issues

No additional likely code-quality/logic issues met the bar after deduplicating cycle-26 deferred findings.

## Risks Needing Manual Validation

### C27-CODE-RISK-01 - Custom modal isolation may not handle later portaled descendants inside focus traps

Severity: Low-Medium  
Confidence: Medium  
Regions:

- `apps/web/src/components/use-modal-tree-isolation.ts:20-65`
- `apps/web/src/components/info-bottom-sheet.tsx:188-220`
- `apps/web/src/components/ui/dropdown-menu.tsx:34-50`
- `apps/web/src/components/photo-viewer.tsx:934-972`

Risk:
`useModalTreeIsolation()` walks and inert-hides existing siblings once when the custom modal opens. Radix `DropdownMenuContent` portals content to `document.body` after interaction. The desktop photo viewer uses the download dropdown outside a custom focus trap, but the mobile info bottom sheet wraps its sheet in `FocusTrap`. If a dropdown/menu is opened from inside the sheet, its content may live outside the trap/modal subtree. That can produce either unreachable keyboard focus or assistive-tech exposure outside the `aria-modal` tree.

Manual validation scenario:
On a mobile-sized viewport, open the photo info bottom sheet for a wide-gamut image with both JPEG and AVIF download options, expand the sheet, open the download dropdown, and test keyboard/screen-reader traversal. Confirm whether menu items receive focus and whether background or unrelated body content appears in the accessibility tree.

Suggested fix if reproduced:
Either render portaled popover/menu content into a container inside the modal root, or move these custom modals to Radix `Dialog`/`Sheet` primitives that coordinate modal layering and portals. Add a browser/a11y regression test for the bottom-sheet download dropdown.

## Validation Evidence

Commands run:

- `git diff --stat d13d6637..HEAD`
- `git diff --name-only d13d6637..HEAD`
- `git ls-files` inventory/counts
- `npm run restore:maintenance --workspace=apps/web -- status` - passed, marker inactive
- `npm test --workspace=apps/web -- sql-restore-scan restore-maintenance` - passed, 2 files / 28 tests
- `npm run lint:api-auth --workspace=apps/web` - passed
- `npm run lint:action-origin --workspace=apps/web` - passed
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed
- Direct helper check via `npm exec --workspace=apps/web -- tsx -e ...` confirmed `containsDangerousSql(...)` returns `false` for the INSERT modifier/no-INTO bypasses and temporary app-table create.

## Final Sweep Confirmation

Final sweep covered:

- Restore and backup: durable marker, recovery CLI, advisory locks, temp-file scanning/import, post-restore migration handoff.
- SQL restore scanner: comment/literal stripping, target allowlist, cross-schema protections, known tests and uncovered MySQL grammar forms.
- Auth/action/API gates: admin API wrapper, same-origin action scanner, public mutating route scanner, semantic/OG/LR routes.
- Upload and processing coordination: browser upload, LR upload, upload tracker, processing contract lock, restore maintenance gates, queue quiesce/resume.
- Data/privacy/schema: public/admin select fields, search enrichment select, Drizzle schema, migration journal, reconcile/migration script.
- UI maintainability: custom modal isolation, search/lightbox/bottom-sheet focus surfaces, Radix portal interaction risk.
- Current review/plan history: current cycle-26 aggregate/deferred list, archived cycle-27 aggregate, and existing code-reviewer report.

Stop condition met: review file written, confirmed findings separated from likely/manual-validation risks, known deferred policy items not repeated, and verification evidence recorded.
