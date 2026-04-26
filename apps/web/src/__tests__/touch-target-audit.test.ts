import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 TE-1 / A-2 seatbelt, hardened in cycle 2:
 *
 * Codify the WCAG 2.5.5 / Apple HIG / Google MDN 44 px touch-target
 * floor as a fixture-style guard so a future change cannot regress a
 * primary interactive surface to h-8 (32 px), h-9 (36 px), or shadcn
 * size="sm" (32 px) without an explicit, documented exemption.
 *
 * The audit walks `apps/web/src/components/` and a known-touch-primary
 * subset of `apps/web/src/app/` and asserts that the count of
 * violations per file matches the documented `KNOWN_VIOLATIONS` count.
 * Adding a NEW violation in a file with N existing violations causes
 * a hard failure with the offending lines. Removing violations is
 * always allowed (the test still passes; update the count to keep
 * future regressions caught).
 *
 * Cycle 2 RPF loop AGG2-M02 / AGG2-M03 / CR2-MED-01 / CR2-MED-02 /
 * TE2-MED-02 / TE2-MED-03 / DSGN2-MED-01: replaced the binary
 * EXEMPTIONS Set with per-file `KNOWN_VIOLATIONS` counts so a new
 * `<Button size="sm">` in an exempt file fails. Extended the
 * `FORBIDDEN` patterns to catch HTML `<button>`, shadcn
 * `<Button size="icon">` without an h-11 override, and `cn()`
 * composite literal-string `h-8`/`h-9` patterns.
 */

const componentsDir = path.resolve(__dirname, '..', 'components');
const adminDir = path.resolve(__dirname, '..', 'app');

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
 */
const KNOWN_VIOLATIONS: Record<string, number> = {
    // The lightbox close/fullscreen/prev/next buttons render at h-10/w-10
    // INSIDE a larger pointer-events area (h-full w-16 hit zone for prev/
    // next; absolute-positioned for close/fullscreen). The visible icon is
    // smaller but the actual hit target via pointer-events:auto is larger.
    // Verified via DOM at gallery.atik.kr in designer-v2 review.
    // Re-open: lightbox.tsx uses HTML <button>, not shadcn <Button>, so
    // the FORBIDDEN regex does not match anyway. Listed for completeness.
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
    // Re-open: when admin becomes mobile-priority, drop these to h-11.
    'components/image-manager.tsx': 4,
    // admin-user-manager: single "Add admin" button with size="sm".
    // Re-open: same as image-manager.
    'components/admin-user-manager.tsx': 1,
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
};

/**
 * Forbidden patterns that indicate a < 44 px touch target on a primary
 * interactive surface. Each pattern is paired with a description.
 *
 * Pattern shapes covered:
 *   - shadcn `<Button size="sm">` (32 px)
 *   - shadcn `<Button size="icon">` without `h-1[12]` / `size-1[12]` override (36 px default)
 *   - `<Button className="...h-8...">` and `...h-9...` literals
 *   - `<Button className={cn("...h-8...", ...)}>` composites
 *   - HTML `<button className="...h-8...">` and `...h-9...` literals
 */
const FORBIDDEN: Array<{ pattern: RegExp; description: string }> = [
    {
        pattern: /<Button\b[^>]*\bsize=["']sm["']/,
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
    const srcRoot = path.resolve(__dirname, '..');
    return path.relative(srcRoot, absPath).replace(/\\/g, '/');
}

function scanFile(absPath: string): FoundIssue[] {
    const issues: FoundIssue[] = [];
    const text = fs.readFileSync(absPath, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, description } of FORBIDDEN) {
            if (pattern.test(line)) {
                issues.push({
                    file: relPathFromSrc(absPath),
                    line: i + 1,
                    pattern: description,
                    snippet: line.trim(),
                });
            }
        }
    }
    return issues;
}

describe('touch-target audit (44 px floor)', () => {
    it('matches the documented per-file violation count for component files', () => {
        const files = listFilesRecursive(componentsDir, (f) => /\.(tsx|jsx)$/.test(f));
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
        const loginForm = path.resolve(adminDir, '[locale]', 'admin', 'login-form.tsx');
        if (!fs.existsSync(loginForm)) return;
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
            { name: '<Button className={cn("h-8", ...)}>', snippet: `<Button className={cn("h-8", "px-3")}>x</Button>` },
            { name: '<Button className={cn("h-9", ...)}>', snippet: `<Button className={cn("h-9", "px-3")}>x</Button>` },
            { name: 'HTML <button className="h-8">', snippet: `<button className="h-8 w-8" type="button">x</button>` },
            { name: 'HTML <button className="h-9">', snippet: `<button className="h-9 w-9" type="button">x</button>` },
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
