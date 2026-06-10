# Run-4 Cycle 4 — designer (UI/UX) angle

Method note: the UI surface has had NO component changes since the
run4-cycle2 designer pass with live artifacts (R4C3 touched zero .tsx
files; R4C1/R4C2's viewer-nav and failed-panel fixes were e2e-verified in
their own cycles). This cycle therefore ran a static deep pass on the
youngest admin surfaces (tokens, sales, dashboard failed-images region)
plus a repo-wide interaction-pattern consistency sweep (Enter-key handlers,
pending-state guards, i18n key parity EN/KO, touch targets via the blocking
vitest audit — green at 1591/1591). The e2e suite re-runs during PROMPT 3.

## Findings

### UX-R4C4-04 — token create dialog: Enter key bypasses the pending guard → duplicate credentials (LOW-MED / High confidence)
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:155`
```tsx
onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
```
The Create BUTTON is `disabled={isPending}` (162), but `handleCreate`
(44-63) has no pending check and the Enter handler calls it unconditionally
and without `preventDefault()`. Failure scenario: admin types a label and
presses Enter twice (or holds the key — key-repeat fires repeatedly while
the server action is in flight) → multiple `createLrToken` calls → multiple
live tokens minted with the same label; only the LAST plaintext is shown
(each result overwrites `setCreatedPlaintext`), so the earlier token(s) are
live credentials whose plaintext nobody ever saw and whose existence the
admin only discovers in the list as confusing same-label duplicates. On a
credential-minting surface this is the worst variant of the double-submit
class. The repo already has the correct pattern in BOTH siblings:
- `components/image-manager.tsx:337-340` — `e.preventDefault(); if
  (!isBatchAddingTag) void handleBatchAddTag();`
- `admin/(protected)/categories/topic-manager.tsx:337-340` —
  `e.preventDefault(); if (!isAddingAlias) handleAddAlias(...)`
Fix: early-return `if (isPending) return;` at the top of `handleCreate` and
add `e.preventDefault()` in the Enter handler (match siblings). Pin in
`client-source-contracts.test.ts` (TEST-R4C4-13).

### I18N-R4C4-05 — tokens admin page surfaces hardcoded English error toasts in the ko locale (LOW-MED / High confidence)
`apps/web/src/app/actions/lr-tokens.ts` returns `t('unauthorized')`
(localized) for auth failures but raw English literals for everything else:
'At least one scope is required' (40), 'Invalid token label' (50, 61),
'Invalid expiry date' (72), 'Expiry date must be in the future' (75),
'Failed to create token' (97), 'Token not found or already revoked' (110).
`tokens-client.tsx` pipes `result.error` straight into `toast.error`
(36, 54, 69). A Korean admin mistyping a label sees an English toast inside
an otherwise fully localized page — the only browser-facing admin surface
left with hardcoded action errors (every sibling action file goes through
`getTranslations('serverActions')`). DISTINCT from DEF-R4C3-01, which
correctly deferred the MACHINE-client LR route strings; this is the
human-facing layer. Fix: add `serverActions.lrToken*` keys to en.json +
ko.json and return `t(...)` for all seven literals; update
`lr-tokens-action.test.ts` expectations (its `getTranslations` mock already
returns the key, so assertions become key-equality — mechanical).

## Checked and clean
- i18n key parity: all 22 `lrToken.*` UI keys exist in BOTH en.json and
  ko.json (scripted check, zero missing).
- Touch targets: blocking audit green; tokens/sales/dashboard surfaces use
  h-11 / min-h-[44px] correctly (icon buttons at 44 px).
- Pending-state affordances: create/revoke buttons show `Loader2` spinners
  and disable correctly (the Enter path above is the only bypass found
  repo-wide — sweep covered all 8 `key === 'Enter'` handlers).
- Focus management: dialogs are Radix `Dialog` (focus trap + Escape close);
  the plaintext-once dialog's `select-all` code block + copy button with
  aria-label is a good pattern.
- Empty/loading states present on the tokens list (spinner + dashed empty
  card with icon).
- `aria-label` present on icon-only revoke/copy buttons, parameterized by
  token label (revokeAria) — screen-reader disambiguation correct.
- No new contrast/reduced-motion/RTL regressions possible (no CSS or
  animation changes since the last live-browser pass).
