import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 21 (R21C21) DES MAJOR-2 / CRIT21-01 — proactive focus-visible scanner.
 *
 * For five consecutive cycles (17-21) the manual focus-visible sweep has
 * surfaced 3-13 fresh `<Link>` / `<a>` / raw `<button>` siblings each cycle
 * that carry interactive `hover:` styling but no `focus-visible:` ring — the
 * textbook "fix one sibling, miss the next" pattern (CLAUDE.md). The cycle-20
 * plan COMMITTED the broad scanner for cycle 21; the designer + critic both
 * flagged the exit criterion as MET. This is that scanner.
 *
 * It walks every `.tsx`/`.jsx` under `components/` + the `app/[locale]/` route
 * tree, normalizes multi-line JSX openings to one logical line (brace/string
 * aware, mirroring `touch-target-audit.test.ts`), and flags any interactive
 * opening tag whose className contains a STANDALONE `hover:` token (the
 * designer's interactive signal) but lacks a focus indicator
 * (`focus-visible:` / `focus:ring` / `focus-within:`). A NEW such element fails
 * the gate. Documented framework-managed exceptions live in `KNOWN_VIOLATIONS`.
 *
 * Why a `hover:`-gated heuristic (not "every interactive element"):
 *   - A standalone `hover:` token is the strongest signal that the element is a
 *     styled, pointer-affordance control whose keyboard users deserve a matching
 *     focus affordance (WCAG 2.4.7 / 2.4.11).
 *   - `group-hover:` / `peer-hover:` are EXCLUDED (the `(?<![\w-])hover:`
 *     lookbehind): those style a child in response to a PARENT's hover, so the
 *     ring usually lives on the parent (`focus-within:` / `group-focus-visible:`).
 *   - shadcn `<Button>` (capital B) is EXCLUDED — it bakes its own
 *     `focus-visible:ring` into the variant; only raw lowercase `<button>` is
 *     scanned.
 *   - `role="option"` elements (search combobox results managed via
 *     `aria-activedescendant`, not Tab focus) are EXCLUDED.
 */

const srcRoot = path.resolve(__dirname, '..');
const componentsDir = path.resolve(srcRoot, 'components');
const localeDir = path.resolve(srcRoot, 'app', '[locale]');

const SCAN_ROOTS: ReadonlyArray<string> = [componentsDir, localeDir];

interface FoundIssue {
    file: string;
    line: number;
    snippet: string;
}

/**
 * Per-file documented count of accepted focus-visible exceptions. A file NOT
 * listed defaults to 0 (the `?? 0` lookup). Adding a NEW uncovered interactive
 * `<Link>`/`<a>`/`<button>` with `hover:` styling fails the gate. Each entry
 * must explain why the exception is acceptable and give a re-open criterion.
 */
const KNOWN_VIOLATIONS: Record<string, number> = {
    // search.tsx — combobox result rows are `<Link role="option">` managed via
    // `aria-activedescendant` (the listbox owns the roving highlight); they are
    // never Tab-focused individually, so a per-item focus-visible ring would be
    // dead CSS. The role="option" exclusion below already drops them, so this is
    // 0 — listed for visibility. Re-open: if the result rows become Tab-focusable.
    'components/search.tsx': 0,
};

const INTERACTIVE_OPEN = /<(Link|a|button)\b/g;
// Standalone hover: token — excludes group-hover:/peer-hover: via the char-class
// lookbehind (the preceding char must NOT be a word char or hyphen).
const HOVER_TOKEN = /(?<![\w-])hover:/;
const FOCUS_INDICATOR = /focus-visible:|focus:ring|focus-within:/;
const ROLE_OPTION = /\brole=["']option["']/;
const HAS_CLASSNAME = /\bclassName=/;
// Standalone Tailwind `group` parent token (NOT `group-hover:` / `group-foo`):
// such a parent deliberately delegates its focus ring to a child via
// `group-focus-visible:` (lightbox prev/next pattern, R19C19 D19-01). The bare
// `group` must not be followed by a word char or hyphen.
const GROUP_PARENT = /(?<![\w-])group(?![\w-])/;
const GROUP_FOCUS_CHILD = /group-focus-visible:/;
// How many lines after a `group`-parent opening tag to scan for the child that
// paints the `group-focus-visible:` ring. The opening tag collapses to one line
// (normalizer), so the child span is only a few lines below.
const GROUP_CHILD_WINDOW = 12;

function listFilesRecursive(dir: string, predicate: (f: string) => boolean): string[] {
    const out: string[] = [];
    function walk(d: string) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile() && predicate(p)) out.push(p);
        }
    }
    walk(dir);
    return out;
}

function relPathFromSrc(absPath: string): string {
    return path.relative(srcRoot, absPath).replace(/\\/g, '/');
}

/**
 * Find the closing `>` of a JSX opening tag starting at `start`, tracking
 * string/template/brace depth so a `>` inside a JS expression (`() => …`,
 * `{a > b}`) or string is not mistaken for the tag close. Mirrors
 * `touch-target-audit.test.ts`'s `findJsxTagEnd`. Returns the `>` index or -1.
 */
function findJsxTagEnd(source: string, start: number): number {
    let braceDepth = 0;
    let stringChar: '"' | "'" | '`' | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const prev = i > 0 ? source[i - 1] : '';
        if (stringChar) {
            if (ch === '\\') { i++; continue; }
            if (ch === stringChar) stringChar = null;
            continue;
        }
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
        if (ch === '"' || ch === "'" || ch === '`') { stringChar = ch as '"' | "'" | '`'; continue; }
        if (ch === '{') { braceDepth++; continue; }
        if (ch === '}') { braceDepth--; continue; }
        if (ch === '>' && braceDepth === 0 && prev !== '=') return i;
    }
    return -1;
}

/**
 * Collapse each interactive opening tag to one logical line (whitespace and
 * comments stripped) so the per-tag predicate can inspect attributes that
 * Prettier wrapped across multiple lines. Keeps the opening `<` on its line.
 */
export function normalizeInteractiveTags(source: string): string {
    let out = '';
    let cursor = 0;
    const re = new RegExp(INTERACTIVE_OPEN.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        const tagStart = m.index;
        const end = findJsxTagEnd(source, tagStart);
        if (end === -1) break;
        out += source.slice(cursor, tagStart);
        const tag = source.slice(tagStart, end + 1);
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
    const normalized = normalizeInteractiveTags(source).replace(/=>/g, '=ARROW');
    const lines = normalized.split('\n');
    const perTag = new RegExp(INTERACTIVE_OPEN.source); // non-global for .test
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!perTag.test(line)) continue;
        if (!HAS_CLASSNAME.test(line)) continue;
        if (!HOVER_TOKEN.test(line)) continue;
        if (FOCUS_INDICATOR.test(line)) continue;
        if (ROLE_OPTION.test(line)) continue;
        // `group` parent whose focus ring is painted by a child via
        // `group-focus-visible:` within the element body (look ahead a small
        // window) — the affordance exists, just on the visible child, not the
        // outer hitbox (lightbox prev/next, R19C19 D19-01).
        if (GROUP_PARENT.test(line)) {
            let childRing = false;
            for (let j = i + 1; j <= Math.min(lines.length - 1, i + GROUP_CHILD_WINDOW); j++) {
                if (GROUP_FOCUS_CHILD.test(lines[j])) { childRing = true; break; }
            }
            if (childRing) continue;
        }
        issues.push({ file: relPath, line: i + 1, snippet: line.trim().slice(0, 240) });
    }
    return issues;
}

function scanFile(absPath: string): FoundIssue[] {
    return scanSource(relPathFromSrc(absPath), fs.readFileSync(absPath, 'utf8'));
}

describe('focus-visible scanner (interactive Link/a/button with hover styling)', () => {
    it('every hover-styled interactive Link/a/button carries a focus indicator', () => {
        const files: string[] = [];
        for (const root of SCAN_ROOTS) {
            files.push(...listFilesRecursive(root, (f) => /\.(tsx|jsx)$/.test(f)));
        }
        const violationsByFile = new Map<string, FoundIssue[]>();
        for (const f of files) {
            const rel = relPathFromSrc(f);
            const issues = scanFile(f);
            if (issues.length > 0) violationsByFile.set(rel, issues);
        }

        const failures: string[] = [];
        for (const [rel, issues] of violationsByFile) {
            const allowed = KNOWN_VIOLATIONS[rel] ?? 0;
            if (issues.length > allowed) {
                const detail = issues.map((i) => `   ${i.file}:${i.line}\n     ${i.snippet}`).join('\n');
                failures.push(`${rel}: found ${issues.length} hover-styled control(s) without a focus indicator, allowed ${allowed}\n${detail}`);
            }
        }

        if (failures.length > 0) {
            throw new Error(
                `Found ${failures.length} file(s) with interactive controls missing a focus-visible ring:\n\n` +
                failures.join('\n\n') + '\n\n' +
                `Either:\n` +
                `  - Add 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' to the control; or\n` +
                `  - If the focus affordance is framework-managed (parent focus-within, role=option, etc.), add a documented KNOWN_VIOLATIONS entry with a re-open criterion.`,
            );
        }
        expect(failures).toEqual([]);
    });

    // Self-checks: the predicate must FLAG a bare hover link and PASS the same
    // link once a focus-visible ring is added; and must NOT flag group-hover/
    // shadcn <Button>/role=option shapes.
    it('flags a hover-styled Link with no focus indicator', () => {
        const bad = `<Link href="/" className="hover:underline text-sm">x</Link>`;
        expect(scanSource('fixture.tsx', bad)).toHaveLength(1);
    });
    it('passes once a focus-visible ring is present', () => {
        const good = `<Link href="/" className="hover:underline focus-visible:ring-2 focus-visible:ring-ring">x</Link>`;
        expect(scanSource('fixture.tsx', good)).toHaveLength(0);
    });
    it('does not flag group-hover (parent-managed) styling', () => {
        const groupHover = `<Link href="/" className="group-hover:scale-105">x</Link>`;
        expect(scanSource('fixture.tsx', groupHover)).toHaveLength(0);
    });
    it('does not flag shadcn <Button> (own ring baked into the variant)', () => {
        const btn = `<Button className="hover:bg-primary/90">x</Button>`;
        expect(scanSource('fixture.tsx', btn)).toHaveLength(0);
    });
    it('does not flag role="option" combobox result rows', () => {
        const opt = `<Link role="option" href="/" className="hover:bg-muted">x</Link>`;
        expect(scanSource('fixture.tsx', opt)).toHaveLength(0);
    });
    it('flags a multi-line hover-styled button after normalization', () => {
        const ml = `<button\n  onClick={() => x()}\n  className="hover:bg-muted px-2"\n>y</button>`;
        expect(scanSource('fixture.tsx', ml)).toHaveLength(1);
    });
    it('does not flag a group parent whose child paints the ring via group-focus-visible', () => {
        const groupParent = `<button className="group h-full w-16 outline-none hover:bg-black/20">\n  <span className="group-focus-visible:ring-2 group-focus-visible:ring-ring">x</span>\n</button>`;
        expect(scanSource('fixture.tsx', groupParent)).toHaveLength(0);
    });
    it('still flags a group parent with no group-focus-visible child', () => {
        const groupNoChild = `<button className="group h-full w-16 outline-none hover:bg-black/20">\n  <span className="text-white">x</span>\n</button>`;
        expect(scanSource('fixture.tsx', groupNoChild)).toHaveLength(1);
    });
});
