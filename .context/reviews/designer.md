# Cycle 9 Designer Review (manual fallback after stalled lane)

## Inventory
- Re-checked the search dialog UX, the photo/share affordance, and the admin bulk-share affordance.
- Focused on user-visible truthfulness: the UI should describe what really happened and expose the labels people actually recognize.

## Confirmed issues

### U9-01 — Share actions can toast “copied” even when nothing reached the clipboard
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/photo-viewer.tsx:263-267`, `apps/web/src/components/image-manager.tsx:176-181`, `apps/web/src/lib/clipboard.ts:1-8`
- **Concrete failure scenario:** clipboard access is denied, but the UI still celebrates success.
- **Suggested fix:** add a fallback copy path and show failure feedback when the helper returns `false`.

### U9-02 — Search results show slug-humanized topic text instead of the canonical topic label
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:232-236`, `apps/web/src/lib/data.ts:650-726`
- **Concrete failure scenario:** a label like `E2E Smoke` is rendered as `E2e Smoke`, or a custom/CJK label is replaced by a slug-derived approximation.
- **Suggested fix:** return and render the real topic label from the search query.
