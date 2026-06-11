# Run-4 Cycle 19 — designer angle

Rotation: the never-reviewed UI-primitive tail (`components/ui/*` with
0-2 run-4 mentions), `password-client.tsx`, plus the **admin-facing UX
consequence** of this cycle's headline finding. Browser-driven passes
were performed extensively in earlier runs (artifacts in
`.context/*.png`, ui-ux-artifacts-*); this cycle's surfaces are
primitive wrappers and an admin card shell, reviewed structurally —
no new browser session was warranted for vendored shadcn primitives.

## DES-R4C19-08 — the broken topic-create flow presents as a USER mistake — UX adjudication of COR-R4C19-01

When `topicRouteSegmentExists` falsely reports a conflict, the admin
sees the localized `slugConflictsWithRoute` validation error ("This
slug conflicts with an existing route") for EVERY slug they try —
including obviously unique ones. The error taxonomy blames the
user's input for a system fault, offers no escape hatch, and is
indistinguishable from the legitimate conflict case. This is the
worst failure shape for trust: the admin retries different slugs,
fails repeatedly, and concludes the product is arbitrary.

No separate UI fix is needed — the root-cause fix restores honest
semantics, and the error message remains correct for REAL conflicts.
Recorded so the severity of COR-R4C19-01 reflects user-facing harm,
not just logic error. (4/6-angle agreement on the finding.)

## UI-primitive sweep (`components/ui/`)

- Grep for sub-44px size literals (`h-8/h-9/size-8/size-9`) across all
  17 primitives: **zero hits** — consistent with the touch-target
  audit's FORBIDDEN set scanning composed usage rather than the
  primitives themselves (Button's own `size="sm"` variants are defined
  in button.tsx but flagged at usage sites by the audit).
- `table.tsx`, `select.tsx`, `alert.tsx`, `alert-dialog.tsx`: stock
  shadcn new-york structure; semantic roles come from Radix; no local
  customization drift found vs the shadcn baseline conventions used
  elsewhere in the repo.
- `sonner.tsx` toaster wrapper: theme pass-through present
  (next-themes), matching the app's dark/light contract.

## password-client.tsx

Card shell with real `<h1>` (`text-2xl font-semibold`) — correct
heading semantics for the page (the admin shell provides the H1 slot
contract); description tied via CardDescription. Form logic lives in
`password-form.tsx` (covered run-4 c5; unchanged since). No findings.

## e2e a11y locks (cross-reference)

`public.spec.ts` heading-hierarchy and focus-trap locks and
`test-fixes.spec.ts` focus-reveal opacity poll are the designer
angle's regression net for previously-fixed findings — verified
present and unchanged this cycle (see test-engineer file).

## Standing designer deferrals

- Histogram mode-cycle aria-label class (plan-286, includes
  NOTE-R4C18-D1 theme-cycle) — un-triggered; carried.
- DEF-R4C16-B manifest dark splash vs system theme — un-triggered;
  carried (generate-pwa-icons.ts's hardcoded `#09090b` bg is part of
  that same standing item; re-confirmed this cycle while reading the
  script, no escalation).
- DEF-R4C11-A aria-live constant string — un-triggered; carried.
