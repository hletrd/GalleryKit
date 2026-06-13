import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 TE-1 / A-2 seatbelt, hardened in cycle 2 + cycle 1
 * (current loop):
 *
 * Codify the WCAG 2.5.5 Target Size (Enhanced) — Level AAA in WCAG 2.2
 * (44×44 px; WCAG 2.2 also adds 2.5.8 Target Size (Minimum), Level AA,
 * 24×24 px — this repo exceeds both) / Apple HIG / Google MDN 44 px
 * touch-target floor as a fixture-style guard so a future change cannot
 * regress a
 * primary interactive surface to h-8 (32 px), h-9 (36 px), or shadcn
 * size="sm" (32 px) without an explicit, documented exemption.
 *
 * The audit walks every directory in `SCAN_ROOTS` recursively for
 * `.tsx`/`.jsx` files and asserts that the count of violations per
 * file matches the documented `KNOWN_VIOLATIONS` count. Adding a
 * NEW violation in a file with N existing violations causes a hard
 * failure with the offending lines. Removing violations is always
 * allowed (the test still passes; update the count to keep future
 * regressions caught).
 *
 * Scan roots (cycle 1 RPF loop AGG1-M01 / AGG1-M02 / AGG1-L02 /
 * AGG1-L10): both the shared `components/` directory AND the admin
 * route group (`app/[locale]/admin/`) are scanned. The latter
 * previously had only `login-form.tsx` checked via a single ad-hoc
 * `scanFile` call, which silently exempted every other admin route
 * file (dashboard-client, topic-manager, tag-manager, settings-client,
 * seo-client) from the audit.
 *
 * Cycle 2 RPF loop AGG2-M02 / AGG2-M03 / CR2-MED-01 / CR2-MED-02 /
 * TE2-MED-02 / TE2-MED-03 / DSGN2-MED-01: replaced the binary
 * EXEMPTIONS Set with per-file `KNOWN_VIOLATIONS` counts so a new
 * `<Button size="sm">` in an exempt file fails. Extended the
 * `FORBIDDEN` patterns to catch HTML `<button>`, shadcn
 * `<Button size="icon">` without an h-11 override, and `cn()`
 * composite literal-string `h-8`/`h-9` patterns.
 */

const srcRoot = path.resolve(__dirname, '..');
const componentsDir = path.resolve(srcRoot, 'components');
const adminDir = path.resolve(srcRoot, 'app', '[locale]', 'admin');
// Cycle 4 RPF loop R27-UX-LOW-1: widen the audit to cover the public
// route group so undersized interactive elements added at page level
// (i.e. inlined into `app/[locale]/(public)/**/page.tsx` instead of
// extracted into a `components/` file) cannot ship silently. Public
// pages are mobile-priority by definition — they're the surfaces a
// client or prospective client touches first.
const publicDir = path.resolve(srcRoot, 'app', '[locale]', '(public)');
// AGG-R5C3-06 (CRT-R5C3-01): `[locale]` ROOT-level route files
// (not-found.tsx, error.tsx, layout.tsx, loading.tsx) live directly under
// `app/[locale]/` — NOT inside a scanned SCAN_ROOTS directory — so they were
// previously unguarded. The cycle-2 anchor-based touch-target fixes landed in
// not-found.tsx / error.tsx (and the skip link in layout.tsx), and any of them
// could silently regress. List them explicitly so the scan covers them without
// double-walking the admin/(public) subdirectories that SCAN_ROOTS already walks.
const appLevelExtraFiles = [
    path.resolve(srcRoot, 'app', 'global-error.tsx'),
    path.resolve(srcRoot, 'app', '[locale]', 'error.tsx'),
    path.resolve(srcRoot, 'app', '[locale]', 'not-found.tsx'),
    path.resolve(srcRoot, 'app', '[locale]', 'layout.tsx'),
    path.resolve(srcRoot, 'app', '[locale]', 'loading.tsx'),
];

/**
 * AGG1-M01 / AGG1-M02 (cycle 1 RPF loop): explicit list of scan roots.
 * Adding a new root here is the single point of change for widening
 * the audit. Each entry must be a directory; files within are filtered
 * by the `.tsx` / `.jsx` extension predicate.
 *
 * Cycle 4 RPF loop R27-UX-LOW-1: `publicDir` added so the public
 * route group is now scanned recursively. Public pages mostly delegate
 * to components/, so the audit is expected to surface zero violations
 * — but a future inline `<Button size="sm">` in any `page.tsx` of the
 * public route group will now fail the gate.
 */
const SCAN_ROOTS: ReadonlyArray<string> = [
    componentsDir,
    adminDir,
    publicDir,
];

interface FoundIssue {
    file: string;
    line: number;
    pattern: string;
    snippet: string;
}

/**
 * Per-file documented count of known < 44 px touch targets. Adding a
 * NEW violation in a listed file causes a failure; removing all
 * violations is always allowed (just update the entry to 0 to keep
 * the file in scope). Files NOT listed are scanned with a hard floor
 * of 0 violations.
 *
 * Each entry must carry a comment explaining why the violations are
 * acceptable, plus a forward-looking re-open criterion.
 *
 * Convention (cycle 1 RPF loop AGG1-L09):
 *   - Files NOT listed default to 0 (the `?? 0` lookup below).
 *   - Files listed with count `0` are kept for VISIBILITY so that a
 *     contributor reading the map sees that the file was considered
 *     and intentionally has no exempt violations. Do not bulk-delete
 *     these — they are documentation, not dead code.
 *   - Files listed with count > 0 are documented exemptions; each
 *     entry must include a re-open criterion comment immediately
 *     above so a reviewer knows when the exemption can be retired.
 */
const KNOWN_VIOLATIONS: Record<string, number> = {
    // The lightbox close/fullscreen buttons render at h-11/w-11, and prev/
    // next use full-height w-16 hit zones around smaller visible icons.
    // Listed for completeness because lightbox.tsx uses HTML <button>, not
    // shadcn <Button>, so the FORBIDDEN regex does not match every size.
    // Re-open: any new compact lightbox control must keep a 44 px hit target.
    'components/lightbox.tsx': 0,
    // shadcn ui primitives are decorative wrappers; touch-target rule
    // applies at the consumer site, not the primitive.
    'components/ui/button.tsx': 0,
    'components/ui/input.tsx': 0,
    'components/ui/select.tsx': 0,
    'components/ui/dropdown-menu.tsx': 0,
    'components/ui/dialog.tsx': 0,
    'components/ui/sheet.tsx': 0,
    'components/ui/popover.tsx': 0,
    'components/ui/card.tsx': 0,
    'components/ui/checkbox.tsx': 0,
    'components/ui/radio-group.tsx': 0,
    'components/ui/textarea.tsx': 0,
    'components/ui/label.tsx': 0,
    'components/ui/tabs.tsx': 0,
    'components/ui/badge.tsx': 0,
    'components/ui/separator.tsx': 0,
    'components/ui/scroll-area.tsx': 0,
    'components/ui/alert.tsx': 0,
    'components/ui/alert-dialog.tsx': 0,
    'components/ui/sonner.tsx': 0,
    'components/ui/skeleton.tsx': 0,
    'components/ui/avatar.tsx': 0,
    'components/ui/tooltip.tsx': 0,
    'components/ui/switch.tsx': 0,
    'components/ui/collapsible.tsx': 0,
    'components/ui/accordion.tsx': 0,
    'components/ui/progress.tsx': 0,
    // photo-viewer-loading.tsx renders an h-8 w-8 SPINNER (decorative,
    // not interactive — aria-hidden="true"). Not a Button, FORBIDDEN
    // regex does not match.
    'components/photo-viewer-loading.tsx': 0,
    // Admin internal surfaces: image-manager and admin-user-manager
    // render edit/delete buttons inside table rows where keyboard
    // tab order is primary. NOT in scope for cycle 1/2 RPF v3
    // (designer-v2 explicitly excluded admin dashboard / upload flow).
    // Re-open: when mobile admin becomes a priority OR a new
    // violation is added — the count below MUST be raised, which is
    // a code-review checkpoint.
    //
    // POST-LIFT NOTE (run-4 cycle 15, closes OBS-R4C14-A): every
    // size="sm"/size="icon" hit counted in this group now renders at
    // ≥ 44 px because ui/button.tsx floors all size variants
    // (min-h-11/size-11/min-h-12/size-12). The entries are retained —
    // NOT retired — because the bare size="sm"/"icon" patterns stay as
    // belt-and-braces against a future variant downgrade (see FORBIDDEN
    // header note); retiring the counts would make that safety net fail
    // the gate on day one of any such downgrade instead of surfacing it
    // as a reviewed diff here.
    // image-manager: the inline-edit and per-row delete buttons all
    // use size="sm" or size="icon"; admin table flow is keyboard-primary.
    // Cycle 3 RPF loop AGG3-M01: count raised from 4 → 5 because the
    // multi-line `<Button … size="sm" onClick={handleShare}>` Share
    // button at line ~303 is now visible to the scanner after the
    // multi-line normalizer landed. The five violations are:
    //   - bulk add tag (`size="sm"`) at the toolbar
    //   - share toolbar button (`size="sm"`)
    //   - delete-selected toolbar (`size="sm"`)
    //   - per-row inline edit (`size="icon"`)
    //   - per-row inline delete (`size="icon"`)
    // US-P41: count raised from 5 → 6 for the new "Bulk edit" size="sm"
    // toolbar button. Same admin keyboard-primary rationale applies.
    // Re-open: when admin becomes mobile-priority, drop these to h-11.
    'components/image-manager.tsx': 6,
    // admin-user-manager: "Add admin" header button (`size="sm"`)
    // and the per-row delete-user icon (`size="icon"`). Cycle 3 RPF
    // loop AGG3-M01: count raised from 1 → 2 because the multi-line
    // delete-user button is now visible to the scanner. Re-open: same
    // as image-manager (admin keyboard-primary on desktop).
    'components/admin-user-manager.tsx': 2,
    // upload-dropzone: 0 (run-4 cycle 16 DES-R4C16-04). The historical
    // "Clear all h-auto p-0" exemption was fixed long ago (it ships
    // min-h-11 now) but the stale budget of 1 stayed — and silently
    // absorbed the topic <select> h-10 violation the c16 native-select
    // patterns surfaced. Budget re-tightened to the actual count so the
    // next dropzone violation fails loud instead of spending a ghost
    // allowance.
    'components/upload-dropzone.tsx': 0,
    // admin-header: single Logout link rendered as size="sm" Button.
    'components/admin-header.tsx': 1,
    // photo-navigation: <Button size="icon" className="h-12 w-12">
    // — the override IS detected by the negative-lookahead regex, so
    // these do NOT trip FORBIDDEN. Documented as 0 to keep the file
    // visible in case the override is removed.
    'components/photo-navigation.tsx': 0,
    // histogram: collapse and cycle-mode buttons both carry min-h-11
    // / min-w-11. Listed as 0 for visibility.
    'components/histogram.tsx': 0,
    // lightbox-color-pip.tsx: pip button carries min-h-11 (44 px) touch target.
    // Listed for visibility; the scanner catches HTML <button> via the generic
    // FORBIDDEN regex, and the min-h-11 override clears the floor.
    'components/lightbox-color-pip.tsx': 0,
    //
    // === Admin route group (cycle 1 RPF loop AGG1-M01) ===
    //
    // The admin (protected) route group is keyboard-primary on
    // desktop; mobile admin is explicitly out of scope per the
    // designer-v2 review (mirrors the `image-manager.tsx` rationale).
    // Each violation below is documented so a NEW violation lands
    // as a hard failure but the documented historical exemptions
    // pass. Re-open across this group: when admin becomes
    // mobile-priority OR a fresh violation lands without bumping
    // the corresponding count.
    //
    // dashboard-client.tsx: five `size="sm"` buttons:
    // - four quick-action buttons ("New upload", "View live", "View admin
    //   photos", "View admin categories")
    // - one retry button per failed image in the failed-images section
    // All on a desktop-priority surface.
    'app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx': 5,
    // topic-manager.tsx: back arrow (`size="icon"`) + per-row
    // edit/delete on each topic row (`size="icon"` x 2).
    'app/[locale]/admin/(protected)/categories/topic-manager.tsx': 3,
    // tag-manager.tsx: back arrow + per-row edit/delete.
    'app/[locale]/admin/(protected)/tags/tag-manager.tsx': 3,
    // settings-client.tsx: single back-arrow `size="icon"`.
    'app/[locale]/admin/(protected)/settings/settings-client.tsx': 1,
    // seo-client.tsx: single back-arrow `size="icon"`.
    'app/[locale]/admin/(protected)/seo/seo-client.tsx': 1,
    // login-form.tsx is keyboard-primary AND audited via the
    // dedicated `it()` block below (cycle 2 RPF loop AGG2-M01 fixed
    // a path-resolution bug that previously silently no-op'd the
    // dedicated assertion); the wider scan also covers it. Listed
    // as 0 to make it explicit that no exemption applies.
    'app/[locale]/admin/login-form.tsx': 0,
};

/**
 * Forbidden patterns that indicate a < 44 px touch target on a primary
 * interactive surface. Each pattern is paired with a description.
 *
 * Pattern shapes covered:
 *   - shadcn `<Button size="sm">` / `<Button size="icon">` without an
 *     explicit `h-1[12]` / `min-h-1[12]` / `size-1[12]` override.
 *     POST-LIFT NOTE (run-4 cycle 15, closes OBS-R4C14-A/DOC-R4C14-03):
 *     `ui/button.tsx` now floors EVERY size variant at ≥ 44 px
 *     (`default`/`sm` = min-h-11, `lg` = min-h-12, `icon`/`icon-sm` =
 *     size-11, `icon-lg` = size-12), so a bare `size="sm"`/`size="icon"`
 *     consumer is actually 44 px-compliant at runtime today. These two
 *     patterns are KEPT deliberately as belt-and-braces: the scanner
 *     cannot see variant CSS, and a future button.tsx downgrade of those
 *     variants would otherwise re-introduce sub-44 targets invisibly.
 *     The matching KNOWN_VIOLATIONS entries below are therefore
 *     conservative documentation of pattern hits, not of real sub-44
 *     rendering.
 *   - `<Button className="...h-8...">`, `...h-9...`, and 40 px
 *     `h-10`/`w-10`/`size-10` literals (explicit downsize overrides —
 *     these DO render sub-44 because the literal beats the variant floor)
 *   - `<Button className={cn("...h-8...", ...)}>` composites
 *   - HTML `<button className="...h-8...">`, `...h-9...`, and 40 px literals
 *   - sub-44 arbitrary values `min-h-[0-43px]` on `<Button>`, `<button>`,
 *     and interactive `<Badge asChild>` wrappers, in both string-literal
 *     and cn() composite forms (run-4 cycle 15 DES-R4C15-03 /
 *     TEST-R4C15-02 — the tag-filter chips shipped 32 px through this
 *     exact blind spot)
 */
const FORBIDDEN: Array<{ pattern: RegExp; description: string }> = [
    // Cycle 3 RPF loop AGG3-M01: allow `h-11`/`h-12`/`min-h-11`/`size-11`
    // override for `size="sm"` mirror of the size="icon" pattern. After
    // the multi-line normalizer collapses tags, common toolbar buttons
    // (e.g. photo-viewer.tsx mobile Info / Share at h-11) no longer trip.
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bsize=["']sm["']/,
        description: 'shadcn <Button size="sm"> without explicit ≥44 px override (belt-and-braces: variant currently floors at min-h-11, see header note)',
    },
    // <Button size="icon"> without an explicit h-1[12] / size-1[12]
    // override on the same tag. Post-lift the variant itself is size-11
    // (44 px) — kept as belt-and-braces against a future variant
    // downgrade (see header note).
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|size-1[12])\b)[^>]*\bsize=["']icon["']/,
        description: '<Button size="icon"> without explicit ≥44 px override (belt-and-braces: variant currently floors at size-11, see header note)',
    },
    // AGG-C4-01 (run-9 c1 CRT-1): the bare `h-`/`w-` token branches below are
    // anchored with `(?<!max-)` so they do NOT match the same token inside a
    // `max-h-…`/`max-w-…` utility. `max-height`/`max-width` are CEILINGS, not
    // floors, and never constrain the tap target — without the lookbehind,
    // `\bh-10\b` matched the `h-10` inside `max-h-10` and falsely flagged a
    // compliant Button. `min-h`/`min-w`/`size` are distinct tokens (real
    // floors) and are intentionally NOT guarded. Verified by the scale-token
    // self-check block below.
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)h-8\b/,
        description: '<Button className="...h-8..."> renders 32 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)h-9\b/,
        description: '<Button className="...h-9..."> renders 36 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:h-10|w-10|size-10)\b/,
        description: '<Button className="...h-10/w-10/size-10..."> renders 40 px on one axis — below 44 px floor',
    },
    // <Button className={cn("...h-8...", ...)}> composites. The cn()
    // helper preserves literal strings that Tailwind emits.
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)h-8\b/,
        description: '<Button className={cn("...h-8...")}> composite renders 32 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)h-9\b/,
        description: '<Button className={cn("...h-9...")}> composite renders 36 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)(?:h-10|w-10|size-10)\b/,
        description: '<Button className={cn("...h-10/w-10/size-10...")}> composite renders 40 px on one axis — below 44 px floor',
    },
    // HTML <button> elements (lowercase b) with literal h-8 / h-9.
    // Excludes `<button type="submit"` etc that don't carry a sizing class.
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)h-8\b/,
        description: 'HTML <button className="...h-8..."> renders 32 px — below 44 px floor',
    },
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)h-9\b/,
        description: 'HTML <button className="...h-9..."> renders 36 px — below 44 px floor',
    },
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:h-10|w-10|size-10)\b/,
        description: 'HTML <button className="...h-10/w-10/size-10..."> renders 40 px on one axis — below 44 px floor',
    },
    // AGG-R8c3-06 (run-8 c3 DES-2): sub-44 Tailwind SCALE tokens
    // (min-h-6/min-w-6/size-6/h-7/…) evaded EVERY pattern above — those only
    // matched the h-8/h-9/h-10/size-10 literals and the min-h-[NNpx] arbitrary
    // values, never the scale shorthands. The topic-manager alias-remove
    // <button> shipped 24 px (min-h-6 min-w-6) through exactly this gap.
    // Tailwind's spacing scale 1-10 = 4-40 px, all below the 44 px (min-h-11)
    // floor; the usual ≥44 override lookahead (h-11/min-h-11/size-11) wins when
    // a compliant utility is co-present. Covers min-h / min-w / size / h / w on
    // both <Button> and <button>, in string-literal and cn() composite forms.
    // AGG-C4-01 (run-9 c1 CRT-1): `(?<!max-)` before the bare `h`/`w` reach of
    // this alternation prevents matching `h`/`w` inside `max-h-…`/`max-w-…`
    // (a ceiling, not a floor). Without it `<Button className="max-h-10">`
    // falsely flagged. `min-h`/`min-w`/`size` stay un-guarded (true floors).
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|w-1[12]|min-h-1[12]|min-w-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)\b/,
        description: '<Button className="...{min-h|min-w|size|h|w}-1..10..."> scale token renders ≤40 px — below 44 px floor',
    },
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|w-1[12]|min-h-1[12]|min-w-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)\b/,
        description: '<Button className={cn("...{min-h|min-w|size|h|w}-1..10...")}> composite scale token renders ≤40 px — below 44 px floor',
    },
    {
        pattern: /<button\b(?![^>]*\b(?:h-1[12]|w-1[12]|min-h-1[12]|min-w-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)\b/,
        description: 'HTML <button className="...{min-h|min-w|size|h|w}-1..10..."> scale token renders ≤40 px — below 44 px floor',
    },
    {
        pattern: /<button\b(?![^>]*\b(?:h-1[12]|w-1[12]|min-h-1[12]|min-w-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)\b/,
        description: 'HTML <button className={cn("...{min-h|min-w|size|h|w}-1..10...")}> composite scale token renders ≤40 px — below 44 px floor',
    },
    // Run-4 cycle 15 DES-R4C15-03 / TEST-R4C15-02: arbitrary-value
    // sub-44 min-heights (`min-h-[32px]`, `min-h-[40px]`, …) evaded every
    // pattern above — the tag-filter chips shipped at 32 px through this
    // gap. `(?:\d|[123]\d|4[0-3])` matches 0-43; `min-h-[44px]`+ stays
    // compliant. The usual h-11/min-h-11/size-11 override lookahead
    // applies (a co-present 44 px utility wins in CSS).
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Button className="...min-h-[<44px]..."> arbitrary value below 44 px floor',
    },
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Button className={cn("...min-h-[<44px]...")}> composite arbitrary value below 44 px floor',
    },
    {
        pattern: /<button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'HTML <button className="...min-h-[<44px]..."> arbitrary value below 44 px floor',
    },
    {
        pattern: /<button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'HTML <button className={cn("...min-h-[<44px]...")}> composite arbitrary value below 44 px floor',
    },
    // `<Badge asChild>` merges its className onto the interactive child
    // (Radix Slot) — gate on `asChild` so decorative (span) badges with
    // compact sizing never trip.
    {
        pattern: /<Badge\b(?=[^>]*\basChild\b)(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Badge asChild className="...min-h-[<44px]..."> sizes its interactive child below the 44 px floor',
    },
    {
        pattern: /<Badge\b(?=[^>]*\basChild\b)(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Badge asChild className={cn("...min-h-[<44px]...")}> composite sizes its interactive child below the 44 px floor',
    },
    // Run-4 cycle 16 DES-R4C16-04 / TEST-R4C16-04: native `<select>`
    // elements. Hand-styled selects sit outside both the shadcn
    // SelectTrigger primitive (which floors at min-h-11 via
    // data-[size]:min-h-11) and every pattern above — the upload topic
    // picker shipped 40 px through exactly this gap. Same ≥44 override
    // lookahead as the c15 patterns (a co-present h-11/min-h-11 wins).
    // AGG-C5-02 (run-9 c2 CRT-1): `(?<!max-)` before the bare `h-8/h-9/h-10`
    // group so `max-h-10` (a CEILING, never the tap target) is NOT flagged —
    // the same false-positive the c1 fix (40a65aef) closed for <Button>/<button>,
    // which had been left open on these <select> patterns. min-h-[<44px] is a
    // true floor and keeps no lookbehind (mirrors the Button min-h branches).
    {
        pattern: /<select\b(?![^>]*\b(?:h-1[12]|min-h-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?<!max-)(?:h-8|h-9|h-10)\b/,
        description: 'native <select className="...h-8/h-9/h-10..."> renders below the 44 px floor',
    },
    {
        pattern: /<select\b(?![^>]*\b(?:h-1[12]|min-h-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?<!max-)(?:h-8|h-9|h-10)\b/,
        description: 'native <select className={cn("...h-8/h-9/h-10...")}> composite renders below the 44 px floor',
    },
    {
        pattern: /<select\b(?![^>]*\b(?:h-1[12]|min-h-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'native <select className="...min-h-[<44px]..."> arbitrary value below the 44 px floor',
    },
    {
        pattern: /<select\b(?![^>]*\b(?:h-1[12]|min-h-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'native <select className={cn("...min-h-[<44px]...")}> composite arbitrary value below the 44 px floor',
    },
    // AGG-R5C3-06 (CRT-R5C3-01): anchor-based touch targets. The cycle-2
    // fixes added `min-h-11` links in g/[key]/page.tsx, not-found.tsx, and
    // error.tsx, but no pattern guarded `<Link>`/`<a>` — so a regression to
    // h-8/h-9/h-10 or a sub-44 arbitrary min-h would ship unseen (the same
    // failure class that drove Badge/select into FORBIDDEN). The ≥44 override
    // lookahead (h-1[12]/min-h-1[12]/size-1[12]) lets a co-present 44 px utility
    // win, so the three fixed `min-h-11` links pass. The lookahead ALSO requires
    // a sizing className present, so sr-only skip links (no h-/min-h token) and
    // plain text links never trip.
    {
        pattern: /<Link\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?:h-8|h-9|h-10)\b/,
        description: '<Link className="...h-8/h-9/h-10..."> renders below the 44 px floor',
    },
    {
        pattern: /<Link\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?:h-8|h-9|h-10)\b/,
        description: '<Link className={cn("...h-8/h-9/h-10...")}> composite renders below the 44 px floor',
    },
    {
        pattern: /<Link\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Link className="...min-h-[<44px]..."> arbitrary value below the 44 px floor',
    },
    {
        pattern: /<Link\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: '<Link className={cn("...min-h-[<44px]...")}> composite arbitrary value below the 44 px floor',
    },
    // HTML <a> anchors (lowercase). Same shapes; gated on a className sizing
    // token so semantic/sr-only anchors do not false-positive.
    {
        pattern: /<a\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\b(?:h-8|h-9|h-10)\b/,
        description: 'HTML <a className="...h-8/h-9/h-10..."> renders below the 44 px floor',
    },
    {
        pattern: /<a\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?:h-8|h-9|h-10)\b/,
        description: 'HTML <a className={cn("...h-8/h-9/h-10...")}> composite renders below the 44 px floor',
    },
    {
        pattern: /<a\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=["'][^"']*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'HTML <a className="...min-h-[<44px]..."> arbitrary value below the 44 px floor',
    },
    {
        pattern: /<a\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bmin-h-\[(?:\d|[123]\d|4[0-3])px\]/,
        description: 'HTML <a className={cn("...min-h-[<44px]...")}> composite arbitrary value below the 44 px floor',
    },
];

function listFilesRecursive(dir: string, predicate: (f: string) => boolean): string[] {
    const out: string[] = [];
    function walk(d: string) {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                walk(p);
            } else if (e.isFile() && predicate(p)) {
                out.push(p);
            }
        }
    }
    walk(dir);
    return out;
}

function relPathFromSrc(absPath: string): string {
    return path.relative(srcRoot, absPath).replace(/\\/g, '/');
}

/**
 * Cycle 3 RPF loop AGG3-M01 / CR3-MED-01 / TE3-MED-01 / V3-MED-01 /
 * D3-MED-01 / DSGN3-MED-01: collapse multi-line `<Button …>` /
 * `<button …>` JSX opening tags into a single logical line BEFORE
 * the per-line FORBIDDEN regex runs. Without this, every
 * Prettier-formatted multi-line Button (most of the codebase) was
 * invisible to the scanner — `KNOWN_VIOLATIONS` matched scanned counts
 * only because the scanner saw nothing on those files.
 *
 * Approach: regex-replace any `<Button …>` / `<button …>` opening tag
 * (matched lazily) with its inner whitespace collapsed to single
 * spaces. This keeps line offsets approximately correct (the opening
 * `<` keeps its line; the closing `>` shifts) while letting the
 * single-line regex set match attributes that previously spanned
 * multiple lines. The `s` flag (dotAll) lets `[^>]*?` cross `\n`.
 */
/**
 * Find the end of a JSX opening tag starting at `<Button`/`<button` at
 * `start`. Walks character-by-character, tracking string/template/brace
 * depth so that `>` inside JS expressions (e.g. `() => ...`,
 * `{a > b ? x : y}`) is not mistaken for the tag's closing `>`. Returns
 * the index of the closing `>` (inclusive) or -1 if no balanced close
 * is found.
 */
function findJsxTagEnd(source: string, start: number): number {
    let braceDepth = 0;
    let stringChar: '"' | "'" | '`' | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const prev = i > 0 ? source[i - 1] : '';
        if (stringChar) {
            // Skip escaped chars in strings
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === stringChar) stringChar = null;
            continue;
        }
        // Strip line/block comments by skipping to their end so a `>`
        // inside `// foo > bar` does not close the tag.
        if (ch === '/' && source[i + 1] === '/') {
            const nl = source.indexOf('\n', i);
            i = nl === -1 ? source.length - 1 : nl;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            i = end === -1 ? source.length - 1 : end + 1;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            stringChar = ch as '"' | "'" | '`';
            continue;
        }
        if (ch === '{') {
            braceDepth++;
            continue;
        }
        if (ch === '}') {
            braceDepth--;
            continue;
        }
        if (ch === '>' && braceDepth === 0 && prev !== '=') {
            // `prev !== '='` rejects `=>` arrow operator (which is only
            // ever inside an expression at brace depth 0 if the JSX is
            // malformed; keep as belt-and-braces). The arrow operator
            // ALWAYS appears inside `{ ... }` (event handler callbacks)
            // so this is doubly defensive.
            return i;
        }
    }
    return -1;
}

export function normalizeMultilineButtonTags(source: string): string {
    let out = '';
    let cursor = 0;
    // Run-4 cycle 15 DES-R4C15-03 / TEST-R4C15-02: `Badge` added to the
    // normalized tag set. `<Badge asChild>` renders its className onto the
    // interactive CHILD element via Radix Slot, so a multi-line Badge
    // opening carrying a sub-44 sizing class is a real touch-target
    // violation that the scanner must be able to see on one logical line
    // (the tag-filter chips shipped exactly this shape unseen).
    // Run-4 cycle 16 DES-R4C16-04 / TEST-R4C16-04: native `select` added
    // (lowercase only — `<SelectTrigger` does not match `<select\b`).
    // AGG-R5C3-06 (CRT-R5C3-01): `Link` (next/link) and lowercase `a` added —
    // anchor-based touch targets (the cycle-2 g/[key], not-found, error links)
    // were invisible to the per-line regex when Prettier wrapped them across
    // multiple lines. `<a\b` matches the HTML anchor but NOT `<area`/`<address`
    // (\b after `a` requires a non-word boundary, and we additionally guard the
    // FORBIDDEN <a> patterns on a className sizing token).
    // AGG-R8-03 (run-8 c2): `input` added so a multi-line raw
    // `<input type="checkbox" … />` collapses to one logical line. Raw
    // checkboxes/radios are NOT styled through the shadcn primitive, so the
    // image-manager select-all + per-row boxes shipped a 32 px tap area unseen
    // by every prior cycle (the FORBIDDEN set only knew Button/button/Badge/
    // select/Link/a). The windowed checkbox scan in scanSource consumes the
    // collapsed `<input>` line.
    const re = /<(Button|button|Badge|select|Link|a|input)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        const tagStart = m.index;
        const end = findJsxTagEnd(source, tagStart);
        if (end === -1) break;
        out += source.slice(cursor, tagStart);
        const tag = source.slice(tagStart, end + 1);
        // Strip JS line + JSX block comments so collapsing whitespace
        // does not extend a `// comment` over the rest of the tag and
        // hide a className override.
        const stripped = tag
            .replace(/\/\/[^\n]*/g, '')
            .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
        out += stripped.replace(/\s+/g, ' ');
        cursor = end + 1;
        re.lastIndex = end + 1;
    }
    out += source.slice(cursor);
    return out;
}

export function scanSource(relPath: string, source: string): FoundIssue[] {
    const issues: FoundIssue[] = [];
    // Cycle 3 RPF loop AGG3-M01: also replace `=>` with a sentinel
    // (`=ARROW`) so the FORBIDDEN regex's `[^>]*` lookahead does not stop
    // at the `>` of arrow-function event handlers (`onClick={() => …}`).
    // Without this, a tag like `<Button size="icon" onClick={() => x}
    // className="h-11">` matches FORBIDDEN because the lookahead
    // `(?![^>]*\bh-1[12]\b)` can only see up to the `>` of `=>`, which
    // misses the `h-11` className that appears later in the same tag.
    const normalized = normalizeMultilineButtonTags(source).replace(/=>/g, '=ARROW');
    const lines = normalized.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, description } of FORBIDDEN) {
            if (pattern.test(line)) {
                issues.push({
                    file: relPath,
                    line: i + 1,
                    pattern: description,
                    snippet: line.trim().slice(0, 240),
                });
            }
        }
    }
    issues.push(...scanRawCheckboxes(relPath, lines));
    return issues;
}

// AGG-R8-03 (run-8 c2): raw `<input type="checkbox">` / `type="radio"` floor.
// These are NOT the shadcn primitive (components/ui/checkbox.tsx) and carry no
// built-in 44 px floor — the repo pattern is to wrap the small visible box in a
// `min-h-11 min-w-11` <label> that provides the tap area. A raw checkbox is a
// violation UNLESS a ≥44 px sizing class is present on its own collapsed tag OR
// on the wrapping element within a small preceding window (the <label> a few
// lines up). This closes the structural blind spot that let the 32 px
// image-manager boxes ship every prior cycle.
const CHECKBOX_44_OK = /\b(?:min-h-1[12]|h-1[12]|min-w-1[12]|w-1[12]|size-1[12])\b/;
function scanRawCheckboxes(relPath: string, lines: string[]): FoundIssue[] {
    const issues: FoundIssue[] = [];
    // Lines back-scanned for the wrapping label's sizing class. The collapsed
    // <label> opening tag is one logical line; a generous window tolerates an
    // <span className="sr-only"> between the label and the input.
    const WINDOW = 4;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/<input\b[^>]*\btype=["'](?:checkbox|radio)["']/.test(line)) continue;
        // The input's own tag clears the floor (e.g. a 44 px checkbox).
        if (CHECKBOX_44_OK.test(line)) continue;
        // Otherwise the wrapping element must supply it within the window.
        let wrapperOk = false;
        for (let j = Math.max(0, i - WINDOW); j < i; j++) {
            if (/<label\b/.test(lines[j]) && CHECKBOX_44_OK.test(lines[j])) {
                wrapperOk = true;
                break;
            }
        }
        if (!wrapperOk) {
            issues.push({
                file: relPath,
                line: i + 1,
                pattern: 'raw <input type="checkbox|radio"> without a ≥44 px tap area (self or wrapping <label>) — below the 44 px floor',
                snippet: line.trim().slice(0, 240),
            });
        }
    }
    return issues;
}

function scanFile(absPath: string): FoundIssue[] {
    const text = fs.readFileSync(absPath, 'utf8');
    return scanSource(relPathFromSrc(absPath), text);
}

describe('touch-target audit (44 px floor)', () => {
    it('matches the documented per-file violation count across all SCAN_ROOTS', () => {
        // AGG1-M01 / AGG1-M02 / AGG1-L02 (cycle 1 RPF loop): walk every
        // root in `SCAN_ROOTS` (components/ + admin route group) so the
        // admin (protected) `*-client.tsx` files are no longer silently
        // exempt. Each root is scanned recursively for .tsx/.jsx; the
        // per-file `KNOWN_VIOLATIONS` count then locks the historical
        // exemptions while catching new violations as a hard failure.
        const files: string[] = [];
        for (const root of SCAN_ROOTS) {
            files.push(...listFilesRecursive(root, (f) => /\.(tsx|jsx)$/.test(f)));
        }
        files.push(...appLevelExtraFiles.filter((file) => fs.existsSync(file)));
        const violationsByFile: Map<string, FoundIssue[]> = new Map();
        for (const f of files) {
            const rel = relPathFromSrc(f);
            const issues = scanFile(f);
            if (issues.length > 0) {
                violationsByFile.set(rel, issues);
            }
        }

        const failures: string[] = [];

        // Detect NEW violations: any file whose actual count exceeds
        // the documented `KNOWN_VIOLATIONS[file]` count (default 0).
        for (const [rel, issues] of violationsByFile) {
            const allowed = KNOWN_VIOLATIONS[rel] ?? 0;
            if (issues.length > allowed) {
                const detail = issues
                    .map((i) => `   ${i.file}:${i.line}  ${i.pattern}\n     ${i.snippet}`)
                    .join('\n');
                failures.push(
                    `${rel}: found ${issues.length} violation(s), allowed ${allowed}\n${detail}`,
                );
            }
        }

        // Detect STALE entries in KNOWN_VIOLATIONS: a file listed with
        // count > 0 but actual count is now 0. This is informational,
        // not a hard failure — it signals that the entry should be
        // dropped from the map but doesn't prevent tests from passing.
        // Hard failures stay reserved for actual regressions.

        if (failures.length > 0) {
            throw new Error(
                `Found ${failures.length} file(s) with NEW touch-target violations:\n\n` +
                failures.join('\n\n') + '\n\n' +
                `Either:\n` +
                `  - Fix the violation by raising to h-11 / min-h-[44px] / size-11; or\n` +
                `  - Update KNOWN_VIOLATIONS in this test with a documented reason and re-open criterion.`,
            );
        }

        // Sanity assertion so the test reports zero failures explicitly.
        expect(failures).toEqual([]);
    });

    it('finds no < 44 px touch targets in admin login form', () => {
        // Cycle 2 RPF loop AGG2-M01 / TE2-MED-01 / V2-MED-01 / D2-MED-01 /
        // CR2-MED-01: resolve from `srcRoot`, NOT `adminDir`. `adminDir`
        // already terminates in `app/[locale]/admin`, so the previous
        // `path.resolve(adminDir, '[locale]', 'admin', 'login-form.tsx')`
        // produced `…/app/[locale]/admin/[locale]/admin/login-form.tsx`,
        // which has never existed. The silent `if (!exists) return;`
        // turned the assertion into a no-op so the test passed vacuously
        // even though it was the dedicated belt-and-braces guard for the
        // highest-traffic admin entry point.
        //
        // Replaced the silent skip with an explicit `expect(...).toBe(true)`
        // so a future move/rename of `login-form.tsx` is a hard failure
        // rather than a silent revert to vacuity.
        const loginForm = path.resolve(srcRoot, 'app', '[locale]', 'admin', 'login-form.tsx');
        expect(fs.existsSync(loginForm), `Login form must exist at ${loginForm}`).toBe(true);
        const issues = scanFile(loginForm);
        expect(issues, `Login form should clear 44 px floor: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
    });

    /**
     * AGG2-M03 / TE2-MED-03: lock the FORBIDDEN regex coverage
     * surface against in-memory fixtures. Each fixture asserts that
     * a given snippet trips at least one FORBIDDEN pattern, so a
     * future refactor that loosens the regex is caught.
     */
    it('FORBIDDEN regex catches HTML <button>, size="icon", and cn() composites', () => {
        const fixtures: Array<{ name: string; snippet: string }> = [
            { name: '<Button size="sm">', snippet: `<Button size="sm">x</Button>` },
            { name: '<Button size="icon"> without h-11', snippet: `<Button size="icon" aria-label="x">x</Button>` },
            { name: '<Button className="h-8">', snippet: `<Button className="h-8 w-8">x</Button>` },
            { name: '<Button className="h-9">', snippet: `<Button className="h-9">x</Button>` },
            { name: '<Button className="h-10 w-10">', snippet: `<Button className="h-10 w-10">x</Button>` },
            { name: '<Button className="size-10">', snippet: `<Button className="size-10">x</Button>` },
            { name: '<Button className={cn("h-8", ...)}>', snippet: `<Button className={cn("h-8", "px-3")}>x</Button>` },
            { name: '<Button className={cn("h-9", ...)}>', snippet: `<Button className={cn("h-9", "px-3")}>x</Button>` },
            { name: '<Button className={cn("size-10", ...)}>', snippet: `<Button className={cn("size-10", "rounded-full")}>x</Button>` },
            { name: 'HTML <button className="h-8">', snippet: `<button className="h-8 w-8" type="button">x</button>` },
            { name: 'HTML <button className="h-9">', snippet: `<button className="h-9 w-9" type="button">x</button>` },
            { name: 'HTML <button className="h-10 w-10">', snippet: `<button className="h-10 w-10" type="button">x</button>` },
            // Run-4 cycle 15 DES-R4C15-03 / TEST-R4C15-02: sub-44
            // arbitrary min-h values and interactive <Badge asChild>
            // wrappers (the pre-fix tag-filter chip shapes).
            { name: '<Button className="min-h-[36px]">', snippet: `<Button className="min-h-[36px]">x</Button>` },
            { name: '<Button className={cn("min-h-[40px]", ...)}>', snippet: `<Button className={cn("min-h-[40px]", "px-3")}>x</Button>` },
            { name: 'HTML <button className="min-h-[40px]">', snippet: `<button className="min-h-[40px]" type="button">x</button>` },
            { name: 'HTML <button className={cn("min-h-[32px]", ...)}>', snippet: `<button className={cn("min-h-[32px]", "px-3")} type="button">x</button>` },
            { name: '<Badge asChild className="min-h-[32px]">', snippet: `<Badge asChild variant="outline" className="min-h-[32px] px-3"><button type="button">x</button></Badge>` },
            { name: '<Badge asChild className={cn("min-h-[32px]", ...)}> (pre-fix tag-filter shape)', snippet: `<Badge asChild variant={active ? "default" : "outline"} className={cn("cursor-pointer hover:bg-primary/90 min-h-[32px] px-3 py-1", active && "bg-primary")}><button type="button">x</button></Badge>` },
            // Run-4 cycle 16 DES-R4C16-04 / TEST-R4C16-04: native <select>
            // shapes (the pre-fix upload topic picker shipped h-10 = 40 px).
            { name: 'native <select className="h-10"> (pre-fix upload topic picker shape)', snippet: `<select id="upload-topic" className="flex h-10 w-full items-center rounded-md border" value={topic}>x</select>` },
            { name: 'native <select className="h-9">', snippet: `<select className="h-9 w-full" value={v}>x</select>` },
            { name: 'native <select className={cn("h-10", ...)}>', snippet: `<select className={cn("h-10", "w-full")} value={v}>x</select>` },
            { name: 'native <select className="min-h-[40px]">', snippet: `<select className="min-h-[40px] w-full" value={v}>x</select>` },
            // AGG-R5C3-06 (CRT-R5C3-01): anchor-based touch targets.
            { name: '<Link className="h-8">', snippet: `<Link href="/x" className="h-8 px-2">x</Link>` },
            { name: '<Link className="h-10">', snippet: `<Link href="/x" className="flex h-10 items-center">x</Link>` },
            { name: '<Link className="min-h-[36px]">', snippet: `<Link href="/x" className="min-h-[36px] px-2">x</Link>` },
            { name: '<Link className={cn("h-9", ...)}>', snippet: `<Link href="/x" className={cn("h-9", "px-2")}>x</Link>` },
            { name: 'HTML <a className="h-8">', snippet: `<a href="/x" className="h-8 px-2">x</a>` },
            { name: 'HTML <a className="min-h-[40px]">', snippet: `<a href="/x" className="min-h-[40px] px-2">x</a>` },
            { name: 'HTML <a className={cn("h-10", ...)}>', snippet: `<a href="/x" className={cn("h-10", "px-2")}>x</a>` },
        ];
        for (const { name, snippet } of fixtures) {
            const matched = FORBIDDEN.some((rule) => rule.pattern.test(snippet));
            expect(matched, `FORBIDDEN regex did not catch: ${name} → ${snippet}`).toBe(true);
        }
    });

    /**
     * AGG2-M03: assert that legitimate 44 px+ snippets do NOT trip
     * the FORBIDDEN regex. False positives waste reviewer time.
     */
    /**
     * Cycle 3 RPF loop AGG3-M01 / CR3-MED-01 / TE3-MED-01: lock that
     * the scanner sees multi-line `<Button>` JSX. Without the
     * multi-line normalizer, the per-line regex never saw a Button
     * formatted across multiple lines (Prettier default for any tag
     * with 3+ props), and `KNOWN_VIOLATIONS` matched scanned counts
     * only because the scanner saw nothing.
     */
    it('scanSource catches multi-line <Button size="icon"> with sub-44px className', () => {
        const multilineSnippet = [
            '<Button',
            '    variant="ghost"',
            '    size="icon"',
            '    className="absolute h-6 w-6 rounded-full"',
            '    onClick={() => removeFile(i)}',
            '>',
            '    <X className="h-4 w-4" />',
            '</Button>',
        ].join('\n');
        const issues = scanSource('fixture/multiline.tsx', multilineSnippet);
        expect(issues.length, `Expected at least one issue, got: ${JSON.stringify(issues)}`).toBeGreaterThan(0);
        expect(issues.some((i) => i.pattern.includes('size="icon"'))).toBe(true);
    });

    it('scanSource catches multi-line <Button size="sm"> without h-11 override', () => {
        const multilineSnippet = [
            '<Button',
            '    variant="destructive"',
            '    size="sm"',
            '    disabled={isBulkDeleting}',
            '>',
            '    Delete',
            '</Button>',
        ].join('\n');
        const issues = scanSource('fixture/multiline-sm.tsx', multilineSnippet);
        expect(issues.length).toBeGreaterThan(0);
    });

    it('scanSource catches multi-line native <select> with sub-44px className and accepts h-11 (DES-R4C16-04)', () => {
        const violating = [
            '<select',
            '    id="upload-topic"',
            '    className="flex h-10 w-full items-center justify-between rounded-md border"',
            '    value={topic}',
            '    onChange={(e) => setTopic(e.target.value)}',
            '>',
            '    <option>x</option>',
            '</select>',
        ].join('\n');
        expect(scanSource('fixture/select-violation.tsx', violating).length).toBeGreaterThan(0);

        const compliant = violating.replace('h-10', 'h-11');
        expect(scanSource('fixture/select-ok.tsx', compliant)).toEqual([]);

        // shadcn SelectTrigger is NOT in the native-select pattern domain
        // (the primitive floors at min-h-11 via data-[size]:min-h-11).
        const selectTrigger = '<SelectTrigger id="avif-effort" className="w-[200px]"><SelectValue /></SelectTrigger>';
        expect(scanSource('fixture/select-trigger-ok.tsx', selectTrigger)).toEqual([]);
    });

    it('scanSource catches a raw <input type="checkbox"> with a sub-44 wrapper and accepts a min-h-11 label (AGG-R8-03)', () => {
        // Pre-fix image-manager shape: a 20 px checkbox inside a 32 px label.
        const violating = [
            '<label className="inline-flex min-h-8 min-w-8 items-center justify-center">',
            '    <span className="sr-only">Select all</span>',
            '    <input',
            '        type="checkbox"',
            '        className="h-5 w-5 rounded border-gray-300"',
            '        checked={all}',
            '        onChange={toggleAll}',
            '    />',
            '</label>',
        ].join('\n');
        const issues = scanSource('fixture/checkbox-violation.tsx', violating);
        expect(issues.length, `Expected a raw-checkbox violation, got: ${JSON.stringify(issues)}`).toBeGreaterThan(0);
        expect(issues.some((i) => i.pattern.includes('raw <input type="checkbox'))).toBe(true);

        // The landed fix: the wrapping label provides the 44 px tap area.
        const compliant = violating.replace('min-h-8 min-w-8', 'min-h-11 min-w-11');
        expect(scanSource('fixture/checkbox-ok.tsx', compliant), 'min-h-11 label should clear the floor').toEqual([]);

        // A radio with the same shape is also caught.
        const radio = violating.replace('type="checkbox"', 'type="radio"');
        expect(scanSource('fixture/radio-violation.tsx', radio).length).toBeGreaterThan(0);

        // shadcn Checkbox primitive (components/ui/checkbox.tsx) is a styled
        // <button role="checkbox">, NOT a raw <input>, so it never enters this
        // scan — a bare <Checkbox /> usage must not false-positive.
        expect(scanSource('fixture/shadcn-checkbox.tsx', '<Checkbox id="x" checked={v} />')).toEqual([]);
    });

    it('scanSource accepts multi-line <Button size="icon"> with h-11 override', () => {
        const multilineSnippet = [
            '<Button',
            '    variant="ghost"',
            '    size="icon"',
            '    onClick={() => doStuff()}',
            '    className="h-11 w-11"',
            '>',
            '    <X className="h-4 w-4" />',
            '</Button>',
        ].join('\n');
        const issues = scanSource('fixture/multiline-ok.tsx', multilineSnippet);
        expect(issues, `Multi-line h-11 override should pass: ${JSON.stringify(issues)}`).toEqual([]);
    });

    it('scanSource accepts multi-line <Button size="sm"> with h-11 override', () => {
        const multilineSnippet = [
            '<Button',
            '    variant="outline"',
            '    size="sm"',
            '    onClick={() => setShowBottomSheet(true)}',
            '    // touch target floor',
            '    className="gap-2 lg:hidden h-11"',
            '>',
            '    Info',
            '</Button>',
        ].join('\n');
        const issues = scanSource('fixture/multiline-sm-ok.tsx', multilineSnippet);
        expect(issues, `Multi-line size="sm" + h-11 should pass: ${JSON.stringify(issues)}`).toEqual([]);
    });

    it('FORBIDDEN regex does not flag valid h-11 / size-11 / overridden size="icon"', () => {
        const fixtures: Array<{ name: string; snippet: string }> = [
            { name: '<Button className="h-11">', snippet: `<Button className="h-11">x</Button>` },
            { name: '<Button size="icon" className="h-11">', snippet: `<Button size="icon" className="h-11 w-11">x</Button>` },
            { name: '<Button size="icon" className="size-11">', snippet: `<Button size="icon" className="size-11">x</Button>` },
            { name: '<Button size="icon" className="h-12">', snippet: `<Button size="icon" className="h-12 w-12">x</Button>` },
            { name: '<Button size="icon" className="size-12">', snippet: `<Button size="icon" className="size-12">x</Button>` },
            { name: '<Button size="default">', snippet: `<Button size="default" className="px-4">x</Button>` },
            { name: 'HTML <button className="h-11">', snippet: `<button className="h-11 w-11" type="button">x</button>` },
            // Run-4 cycle 15 DES-R4C15-03 / TEST-R4C15-02 compliant shapes:
            // 44 px chips, ≥44 arbitrary values, 3-digit arbitrary values,
            // co-present ≥44 override, and DECORATIVE (non-asChild) badges
            // whose compact sizing is not a touch target.
            { name: '<Badge asChild className={cn("min-h-11", ...)}> (fixed chip shape)', snippet: `<Badge asChild variant="outline" className={cn("cursor-pointer min-h-11 px-3 py-1", active && "bg-primary")}><button type="button">x</button></Badge>` },
            { name: '<Badge asChild className="min-h-[44px]">', snippet: `<Badge asChild className="min-h-[44px] px-3"><button type="button">x</button></Badge>` },
            { name: 'decorative <Badge className="min-h-[32px]"> (no asChild)', snippet: `<Badge variant="secondary" className="min-h-[32px] px-2">3 photos</Badge>` },
            { name: 'HTML <button className="min-h-[44px]">', snippet: `<button className="min-h-[44px]" type="button">x</button>` },
            { name: 'HTML <button className="min-h-[120px]"> (3-digit)', snippet: `<button className="min-h-[120px]" type="button">x</button>` },
            { name: '<Button className="min-h-[40px] min-h-11"> (override wins)', snippet: `<Button className="min-h-[40px] min-h-11">x</Button>` },
            // AGG-R5C3-06 (CRT-R5C3-01): the cycle-2 fixed links (min-h-11),
            // sr-only skip links (no sizing token), and plain text links must
            // NOT trip.
            { name: '<Link className="min-h-11"> (cycle-2 fixed shape)', snippet: `<Link href="/x" className="flex items-center gap-1 min-h-11">x</Link>` },
            { name: '<Link className="inline-flex min-h-11"> (not-found fix)', snippet: `<Link href="/x" className="inline-flex items-center min-h-11 text-primary">x</Link>` },
            { name: 'sr-only skip <a> (no sizing token)', snippet: `<a href="#main-content" className="sr-only focus:not-sr-only focus:px-4 focus:py-2">Skip</a>` },
            { name: 'plain text <Link> (no sizing)', snippet: `<Link href="/x" className="text-sm text-muted-foreground hover:text-primary">x</Link>` },
            { name: 'HTML <a className="min-h-[44px]">', snippet: `<a href="/x" className="min-h-[44px] px-2">x</a>` },
            { name: '<a className="h-10 min-h-11"> (override wins)', snippet: `<a href="/x" className="h-10 min-h-11">x</a>` },
            // AGG-C4-01 (run-9 c1 CRT-1): `max-h-…`/`max-w-…` are CEILINGS, not
            // floors — they never constrain the tap target and MUST NOT be
            // flagged. Before the `(?<!max-)` lookbehind, `\bh-10\b` matched the
            // `h-10` inside `max-h-10` and falsely flagged a compliant Button.
            // These are the regression pins for the false positive.
            { name: '<Button className="max-h-10"> (ceiling, not a floor)', snippet: `<Button className="max-h-10">x</Button>` },
            { name: '<Button className="max-w-9"> (ceiling, not a floor)', snippet: `<Button className="max-w-9">x</Button>` },
            { name: '<Button className="max-h-8"> (ceiling)', snippet: `<Button className="max-h-8">x</Button>` },
            { name: '<Button className="max-w-10"> (ceiling)', snippet: `<Button className="max-w-10">x</Button>` },
            { name: '<Button className="max-h-screen"> (named ceiling)', snippet: `<Button className="max-h-screen">x</Button>` },
            { name: '<Button className="max-w-full"> (named ceiling)', snippet: `<Button className="max-w-full">x</Button>` },
            { name: '<Button className={cn("max-h-10", ...)}> (cn ceiling)', snippet: `<Button className={cn("max-h-10", "px-4")}>x</Button>` },
            { name: 'HTML <button className="max-h-9"> (ceiling)', snippet: `<button className="max-h-9" type="button">x</button>` },
            { name: 'HTML <button className={cn("max-w-10", ...)}> (cn ceiling)', snippet: `<button className={cn("max-w-10", "px-4")} type="button">x</button>` },
            // AGG-C5-02 (run-9 c2 CRT-1): the same `max-` ceiling false positive
            // existed on the native <select> patterns (the c1 fix only reached
            // <Button>/<button>). A `<select className="max-h-10">` must NOT flag
            // (max-height is a ceiling). These pin the <select> half of the fix.
            { name: 'native <select className="max-h-10"> (ceiling, not a floor)', snippet: `<select className="max-h-10 w-full" value={v}>x</select>` },
            { name: 'native <select className="max-h-8"> (ceiling)', snippet: `<select className="max-h-8 w-full" value={v}>x</select>` },
            { name: 'native <select className={cn("max-h-10", ...)}> (cn ceiling)', snippet: `<select className={cn("max-h-10", "w-full")} value={v}>x</select>` },
            { name: 'native <select className="max-h-screen"> (named ceiling)', snippet: `<select className="max-h-screen w-full" value={v}>x</select>` },
        ];
        for (const { name, snippet } of fixtures) {
            const matched = FORBIDDEN.some((rule) => rule.pattern.test(snippet));
            expect(matched, `FORBIDDEN regex falsely flagged: ${name} → ${snippet}`).toBe(false);
        }
    });

    /**
     * Run-4 cycle 15 DES-R4C15-03 / TEST-R4C15-02: lock that the scanner
     * sees multi-line `<Badge asChild>` wrappers (the tag-filter chips
     * are Prettier-formatted across multiple lines). Without `Badge` in
     * the normalizer tag set, the per-line regex never saw the opening.
     */
    it('scanSource catches multi-line <Badge asChild> with sub-44 min-h composite', () => {
        const multilineSnippet = [
            '<Badge',
            '    key={tag.id}',
            '    asChild',
            '    variant={active ? "default" : "outline"}',
            '    className={cn(',
            '        "cursor-pointer hover:bg-primary/90 min-h-[32px] px-3 py-1",',
            '        "flex gap-1",',
            '        active && "bg-primary text-primary-foreground"',
            '    )}',
            '>',
            '    <button type="button">x</button>',
            '</Badge>',
        ].join('\n');
        const issues = scanSource('fixture/multiline-badge.tsx', multilineSnippet);
        expect(issues.length, `Expected at least one issue, got: ${JSON.stringify(issues)}`).toBeGreaterThan(0);
        expect(issues.some((i) => i.pattern.includes('Badge asChild'))).toBe(true);
    });

    it('scanSource accepts multi-line <Badge asChild> with min-h-11 chip sizing', () => {
        const multilineSnippet = [
            '<Badge',
            '    asChild',
            '    variant="outline"',
            '    className={cn("cursor-pointer min-h-11 px-3 py-1", active && "bg-primary")}',
            '>',
            '    <button type="button">x</button>',
            '</Badge>',
        ].join('\n');
        const issues = scanSource('fixture/multiline-badge-ok.tsx', multilineSnippet);
        expect(issues, `min-h-11 Badge chip should pass: ${JSON.stringify(issues)}`).toEqual([]);
    });
});
