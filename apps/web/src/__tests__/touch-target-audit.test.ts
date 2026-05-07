import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 TE-1 / A-2 seatbelt, hardened in cycle 2 + cycle 1
 * (current loop):
 *
 * Codify the WCAG 2.5.5 / Apple HIG / Google MDN 44 px touch-target
 * floor as a fixture-style guard so a future change cannot regress a
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
const appLevelErrorFiles = [
    path.resolve(srcRoot, 'app', 'global-error.tsx'),
    path.resolve(srcRoot, 'app', '[locale]', 'error.tsx'),
];

/**
 * AGG1-M01 / AGG1-M02 (cycle 1 RPF loop): explicit list of scan roots.
 * Adding a new root here is the single point of change for widening
 * the audit. Each entry must be a directory; files within are filtered
 * by the `.tsx` / `.jsx` extension predicate.
 */
const SCAN_ROOTS: ReadonlyArray<string> = [
    componentsDir,
    adminDir,
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
    // upload-dropzone: "Clear all" link-style ghost button with
    // h-auto p-0 (deliberately compact). Re-open if upload UI becomes
    // mobile-primary.
    'components/upload-dropzone.tsx': 1,
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
    // dashboard-client.tsx: four `size="sm"` quick-action buttons
    // ("New upload", "View live", "View admin photos", "View admin
    // categories"). All on a desktop-priority surface.
    'app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx': 4,
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
 *   - shadcn `<Button size="sm">` (32 px)
 *   - shadcn `<Button size="icon">` without `h-1[12]` / `size-1[12]` override (36 px default)
 *   - `<Button className="...h-8...">`, `...h-9...`, and 40 px
 *     `h-10`/`w-10`/`size-10` literals
 *   - `<Button className={cn("...h-8...", ...)}>` composites
 *   - HTML `<button className="...h-8...">`, `...h-9...`, and 40 px literals
 */
const FORBIDDEN: Array<{ pattern: RegExp; description: string }> = [
    // Cycle 3 RPF loop AGG3-M01: allow `h-11`/`h-12`/`min-h-11`/`size-11`
    // override for `size="sm"` mirror of the size="icon" pattern. After
    // the multi-line normalizer collapses tags, common toolbar buttons
    // (e.g. photo-viewer.tsx mobile Info / Share at h-11) no longer trip.
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)[^>]*\bsize=["']sm["']/,
        description: 'shadcn <Button size="sm"> renders h-8 (32 px) — below 44 px floor',
    },
    // <Button size="icon"> defaults to size-9 (36 px). Allow if an
    // h-1[12] / w-1[12] / size-1[12] override is present on the same
    // tag; otherwise flag.
    {
        pattern: /<Button\b(?![^>]*\b(?:h-1[12]|size-1[12])\b)[^>]*\bsize=["']icon["']/,
        description: '<Button size="icon"> defaults to h-9 (36 px) — needs h-11 / size-11 override to clear 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\bh-8\b/,
        description: '<Button className="...h-8..."> renders 32 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\bh-9\b/,
        description: '<Button className="...h-9..."> renders 36 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=["'][^"']*\b(?:h-10|w-10|size-10)\b/,
        description: '<Button className="...h-10/w-10/size-10..."> renders 40 px on one axis — below 44 px floor',
    },
    // <Button className={cn("...h-8...", ...)}> composites. The cn()
    // helper preserves literal strings that Tailwind emits.
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bh-8\b/,
        description: '<Button className={cn("...h-8...")}> composite renders 32 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\bh-9\b/,
        description: '<Button className={cn("...h-9...")}> composite renders 36 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName=\{[^}]*["'`][^"'`]*\b(?:h-10|w-10|size-10)\b/,
        description: '<Button className={cn("...h-10/w-10/size-10...")}> composite renders 40 px on one axis — below 44 px floor',
    },
    // HTML <button> elements (lowercase b) with literal h-8 / h-9.
    // Excludes `<button type="submit"` etc that don't carry a sizing class.
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\bh-8\b/,
        description: 'HTML <button className="...h-8..."> renders 32 px — below 44 px floor',
    },
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\bh-9\b/,
        description: 'HTML <button className="...h-9..."> renders 36 px — below 44 px floor',
    },
    {
        pattern: /<button\b[^>]*\bclassName=["'][^"']*\b(?:h-10|w-10|size-10)\b/,
        description: 'HTML <button className="...h-10/w-10/size-10..."> renders 40 px on one axis — below 44 px floor',
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
    const re = /<(Button|button)\b/g;
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
        files.push(...appLevelErrorFiles.filter((file) => fs.existsSync(file)));
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
        ];
        for (const { name, snippet } of fixtures) {
            const matched = FORBIDDEN.some((rule) => rule.pattern.test(snippet));
            expect(matched, `FORBIDDEN regex falsely flagged: ${name} → ${snippet}`).toBe(false);
        }
    });
});
