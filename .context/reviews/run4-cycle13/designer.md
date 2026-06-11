# Run-4 Cycle 13 — designer angle (UI/UX)

Full-inventory in-context pass (single-subagent constraint documented in the
aggregate; static DOM/source review — no live browser this cycle, consistent
with run4-c9..c12 practice; findings are text-evidenced with selectors/lines).

Inventory: `topic-manager.tsx` (full — table, create dialog, edit dialog,
map Switch, delete confirm), the rotation surfaces' UI consumers
(`error-shell.ts` brand resolution, blur placeholder consumer contract),
and the admin categories flow around the cycle's primary finding.

## Findings

### DES-R4C13-A — rename silently flips the Map switch OFF with zero feedback (symptom of COR-R4C13-01)
**Severity: MED (admin UX trust) / Confidence: HIGH — resolved by the backend fix**

- `topic-manager.tsx` renders the per-topic Map `<Switch
  checked={topic.map_visible}>` (line 244) in the SAME table row as the
  Edit (Pencil) button that opens the slug-rename dialog (line 251 →
  `updateTopic` at line 101). After a rename the row re-renders with the
  switch OFF — the admin gets a success toast for the rename and no signal
  that an unrelated setting changed. This violates the principle that a
  mutation's visible effects match its stated scope.
- The correct remedy is the backend carry (COR-R4C13-01), NOT a UI warning:
  once the value survives the rename there is nothing to warn about. No
  client change scheduled.

### Clean-pass notes

- Map Switch accessibility: `aria-label={t('categories.mapVisibleToggle',
  { label })}` — per-row distinguishable name, localized (EN/KO). Disabled
  state during the in-flight toggle (`togglingMapSlug`) prevents
  double-fire. Good.
- Edit/Delete icon buttons carry `aria-label={t('aria.editItem')}` /
  `t('aria.deleteItem')`. NOTE: `size="icon"` Buttons here are listed in
  the touch-target audit's documented-exemption ledger for admin
  keyboard-primary surfaces (KNOWN_VIOLATIONS) — re-checked that no NEW
  violation is added by this cycle (no UI edits planned).
- Error-shell brand resolution (`error-shell.ts`) — fallback chain
  dataset → document.title segment → nav-title → title → 'Gallery' is
  locale-safe and never renders an empty brand. Fine.
- The create-topic dialog's image-processing failure path surfaces a
  localized warning (`topicImageProcessingWarning`) while still creating
  the topic — matches the action contract (`warning` field) and avoids
  data loss for the text fields. Good pattern.

## HARD-SCOPE check

No UI feature proposals (no edit/culling/scoring surfaces). The single
finding resolves via the scheduled backend fix.
