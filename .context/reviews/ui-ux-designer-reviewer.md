# UI/UX Designer Reviewer - Cycle 6/100

Role: `ui-ux-designer-reviewer` custom reviewer, adapted from the registered BurstPick prompt to GalleryKit's Next.js web photo-gallery/admin product. Scope: PROMPT 1 reviewer-style UI/UX/design-system critique focused on professional photographer/admin gallery workflows, visual consistency, accessibility, density, interaction efficiency, touch-target policy, i18n, and public photo browsing.

No fixes implemented. No commit, push, or deploy performed. Review is against current HEAD `5443009e`.

## Context Loaded

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`
- Prior/current review context under `.context/reviews/`, including `.context/reviews/_aggregate.md`, `.context/reviews/ui-ux-r2/`, previous `.context/reviews/ui-ux-designer-reviewer.md`, and designer archive entries relevant to stale/deferred UX issues.

The registered reviewer prompt is authored for BurstPick/SwiftUI. I applied its professional creative-tool criteria to GalleryKit: public photo browsing, photo detail/lightbox, mobile bottom sheet, color/HDR audit surfaces, upload/admin management, analytics, DB operations, i18n, and design-system enforcement.

## Inventory Before Findings

I rebuilt the review inventory before evaluating issues:

- Product UI inventory: 103 files in `apps/web/src/app/[locale]`, `apps/web/src/components`, and `apps/web/messages`.
- Broader UI/test evidence inventory: 353 files including `apps/web/src/__tests__`.
- Static inventory command evidence: `/tmp/gallery-uiux-product-inventory.txt` and `/tmp/gallery-uiux-inventory.txt` generated during review; not committed.

Product-facing inventory categories:

- Public route pages: home/topic/smart collection/shared group/shared photo/photo detail/timeline/year/map/loading/layout/error/not-found.
- Admin route pages: login, protected layout/loading/error, dashboard, categories, tags, settings, SEO, DB, password, users, tokens, analytics.
- Shared components: nav/search/home masonry/load-more/photo viewer/photo navigation/lightbox/info bottom sheet/color details/histogram/map/similar photos/upload/image manager/bulk edit/admin header/nav/user manager/tag input/filter/footer/UI primitives.
- Messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Tests checked for review-relevant guards: touch target audit, focus-visible scanner, i18n key parity, info-bottom-sheet IA, lightbox controls, search disclaimer, plus source-contract tests referenced by comments and prior reviews.

Files intentionally not line-by-line inspected: non-UI API routes, server actions, DB/schema/image-processing internals, and most non-UI unit tests. They were out of this reviewer scope unless referenced by a UI contract, message, or test guard.

## Validation Evidence

Focused static/UI gates passed:

```text
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/search-disclaimer.test.ts

Test Files  6 passed (6)
Tests       42 passed (42)
```

No browser setup was used, per request, because the main designer lane is separately doing browser-backed review.

## Confirmed Issues

### UIUX-C6-01 - Mobile photo-viewer toolbar can overflow with long localized topic names

Severity: Medium
Confidence: High
Status: Confirmed from source

Evidence:

- `apps/web/src/components/photo-viewer.tsx:578-587` renders a toolbar row with a back button whose visible text is `t('viewer.backTo', { topic: image.topic_label || image.topic })`.
- `apps/web/src/components/photo-viewer.tsx:591-640` renders the lightbox, info, and share controls in the same unwrapped row.
- `apps/web/src/components/ui/button.tsx:8` applies `whitespace-nowrap` to every `Button`, so the back button text cannot wrap.

Why this is a problem:

The photo viewer is a high-frequency public browsing and admin review surface. On narrow screens, a long topic label plus Korean copy such as `<topic>로 돌아가기` can consume most of the 320-390 px viewport. The toolbar container is `flex items-center justify-between` with no `min-w-0`, no truncation, and no `flex-wrap`; the right-side controls also need fixed 44 px targets. The result is horizontal overflow or squeezed controls in exactly the mobile public browsing workflow where touch targets and predictable chrome matter most.

Failure scenario:

A Korean visitor opens a photo from a topic named `2026 서울 국제 웨딩 포트폴리오 하이라이트`. The back button label becomes a long no-wrap string, while Lightbox, Info, and Share still sit to its right. On an iPhone SE-width viewport, the row cannot fit; the share/info controls may be pushed off-screen or the page may gain horizontal scroll.

Suggested fix:

Make the toolbar resilient to localized/topic expansion. Options:

- Put the back label in a `min-w-0 max-w-* truncate` span inside the button.
- Use an icon-only back button below a small breakpoint with a localized `aria-label`.
- Allow a two-row toolbar on mobile: back navigation row first, action controls row second.
- Add a source-level or component test fixture for a long Korean topic label.

### UIUX-C6-02 - DB admin page uses one pending state for backup, restore, and export, so unrelated operations show false processing states

Severity: Low
Confidence: High
Status: Confirmed from source

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:28` declares a single `const [isPending, startTransition] = useTransition();`.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:143-149` uses that shared state for backup button disablement and label.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:195-201` uses the same shared state for restore button disablement and label.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:238-245` uses the same shared state for CSV export button disablement and label.

Why this is a problem:

Backup, restore, and export are distinct admin workflows with different risk profiles. A professional admin surface must communicate exactly what operation is running. The current shared pending flag means clicking Backup can also make Restore and Export render their own "processing" labels, even though neither operation started. This is especially poor around restore, where destructive state needs precise communication.

Failure scenario:

An admin clicks "Backup". While the backup server action is pending, the Restore and Export cards are also disabled and can display restore/export processing labels. The admin can misread the screen as a restore or export in progress, hesitate, or assume a destructive restore has begun when only a backup is running.

Suggested fix:

Use operation-specific state, e.g. `pendingAction: 'backup' | 'restore' | 'export' | null`, or separate transitions/states for each card. Disable unrelated actions if needed, but keep their labels honest: "Backup processing" only on backup; restore/export can remain disabled with unchanged labels or an explicit "Another DB operation is running" explanation.

## Likely Issues

None filed. The likely candidates I found were either already fixed in current HEAD or lacked enough source-only evidence for this pass.

## Risks Needing Manual Validation

- Long localized toolbar text should be validated in a real browser at 320 px, 375 px, and 390 px widths with Korean locale and a long topic label. Source evidence is strong enough to file the issue, but screenshot evidence would define the exact breakpoint and visual failure mode.
- DB page pending-state wording should be checked with actual messages in both locales during a slow backup/export/restore action to confirm the user-visible text severity.

## Rechecked Non-Findings

- Touch-target policy is actively guarded by `touch-target-audit.test.ts`, and the focused suite passed. `Button` variants now floor `sm` and `icon` at 44 px via `components/ui/button.tsx`.
- Focus-visible coverage is actively guarded by `focus-visible-links-scan.test.ts`, and the focused suite passed.
- English/Korean key parity is guarded by `i18n-key-parity.test.ts`, and the focused suite passed.
- Prior analytics locale issue is fixed in current HEAD: `analytics-client.tsx` receives `locale`, uses `localizePath(locale, ...)`, uses localized `opensInNewWindow`, and formats counts with `toLocaleString(locale)`.
- Prior mobile color-details disparity is fixed in current HEAD: `info-bottom-sheet.tsx` now renders `ColorDetailsSection`, `WideGamutHint`, and `Histogram`.
- Prior color-details accordion a11y issues are fixed in current HEAD: `color-details-section.tsx` has `aria-expanded`, `aria-controls`, focus-visible rings, and sibling focusable tooltip/copy buttons.
- Prior public transfer-function jargon risk is reduced: `ColorDetailsSection` gates `transfer_function` on `isAdmin`.
- Reduced-motion handling is global in `globals.css` and includes suppression of `group-hover:scale-105`.

## Final Missed-Issues Sweep

Final sweep covered:

- Long/visible English strings and locale-key drift.
- Interactive elements, touch-target classes, raw buttons, links, focus-visible treatment, live regions, and ARIA labels.
- Public masonry, topic/timeline/year/shared browsing, photo detail, lightbox, bottom sheet, search, map, similar photos, and load-more paths.
- Admin dashboard/upload/image manager/bulk edit/categories/tags/settings/SEO/DB/password/users/tokens/analytics paths.
- UI primitives for Button/Dialog/AlertDialog/Select/Switch/Input/Tooltip and global CSS motion/forced-colors rules.
- Prior `.context/reviews` issues likely to be stale duplicates.

No additional confirmed UI/UX findings found in this static/source/test/docs pass.
