# critic — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Critique designer-v2 findings from user-impact, code-velocity, regression
risk, and team-process angles.

## Critiques

### C-1 (High) — Touch-target audit was scoped per-file, not project-wide

The fix wave addressed F-1 (tag-filter), F-2 (nav expand), F-3 (search),
F-20 (photo viewer toolbar Info/Back), but did not extend the audit to
all interactive elements in all surfaces. The result: 5 buttons (CR-1,
CR-3, CR-4, CR-5, CR-6) still ship at < 44 px after 11 commits.
**Action:** This cycle's plan must include an audit step (file + grep
result inventory) before declaring touch-target work complete, OR codify
the rule as a fixture test.

### C-2 (High) — NF-3 broken aria-labels in production

The F-18 fix landed code that consolidates the *display* layer correctly
but the *data* layer silently returns null. So a screen-reader user sees
"View photo: Untitled" 30 times in a row. Most severe regression because
the fix appears landed but is functionally inert. **Action:** Plan must
schedule both the SQL fix AND a regression test exercising the
`getImagesLite -> getConcisePhotoAltText` data flow with a real DB row
that has tags.

### C-3 (Medium) — Site title link DOM-measured 28 px overstated

NF-6 calls out 28 px height. The parent `flex items-center` row provides
~64 px of vertical hit area in practice (parent `h-16`). User who taps
the title doesn't have to land within the 28 px text bounds. Low
severity in practice. Still fix it (cheap, low-risk), but don't treat as
urgent.

### C-4 (Medium) — Desktop Info toggle 32 px height matches `size="sm"` (h-8) in shadcn

The NF-2 measurement of `{h:32}` is consistent with shadcn `size="sm"`
mapping to `h-8`. designer-v2 said `size="sm"` is `h-9` but the actual
shadcn variant is `h-8`. The fix is to remove `size="sm"` and use
explicit `h-11`.

### C-5 (Low) — Deferred backlog growing every cycle

`.context/plans/` has 30+ deferred files. The exit criteria are abstract.
**Action:** Skim the deferred backlog briefly to identify items now in
scope (none expected for cycle 1, but the pass should be documented).

## Verdict

The cycle's most important fix is NF-3 (broken aria-labels). NF-2
(LightboxTrigger 32 px) is the second-most user-impacting because it
affects the primary fullscreen interaction on every photo page. NF-1, 4,
5 are easy wins. NF-6 is technically correct but practically Low impact.
