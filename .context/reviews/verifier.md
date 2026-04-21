# Cycle 9 Verifier Review (manual fallback after context-window failure)

## Inventory
- Re-checked the public search query/data contract (`apps/web/src/lib/data.ts`, `apps/web/src/components/search.tsx`, `apps/web/e2e/public.spec.ts`, `apps/web/scripts/seed-e2e.ts`).
- Re-checked share-link creation/copy flows (`apps/web/src/lib/clipboard.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/app/actions/sharing.ts`).
- Re-checked duplicate-entry handling (`apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/validation.ts`).

## Confirmed issues

### V9-01 — Share-link copy surfaces can report success even when clipboard writes fail
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/lib/clipboard.ts:1-8`, `apps/web/src/components/photo-viewer.tsx:263-267`, `apps/web/src/components/image-manager.tsx:176-181`
- **Why it matters:** both share UIs awaited a boolean-returning helper and then unconditionally showed a success toast.
- **Concrete failure scenario:** on an unsupported or denied clipboard surface, the UI claims the link was copied even though nothing reached the clipboard.
- **Suggested fix:** add a fallback copy path and branch the toasts on the boolean result.

### V9-02 — Public search does not match the topic names users actually see
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/data.ts:650-726`, `apps/web/src/components/search.tsx:18-24,232-236`
- **Why it matters:** the UI shows canonical topic labels, but the search backend only matched slug/title/description/tag text.
- **Concrete failure scenario:** typing the visible topic label (for example the seeded `E2E Smoke`) returns nothing even though matching photos are present.
- **Suggested fix:** include canonical topic labels and aliases in the search query and return the label for rendering.
