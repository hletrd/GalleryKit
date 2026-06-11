import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run-4 Cycle 16 COR-R4C16-01 / TEST-R4C16-01: settle-before-close
 * lock for AlertDialog confirm actions.
 *
 * The repo's `ui/alert-dialog.tsx` ships the raw Radix
 * `AlertDialogPrimitive.Action`, which CLOSES THE DIALOG ON CLICK
 * regardless of any async work started by the onClick handler. Cycle
 * 14 (DES-R4C14-B, commit 82e35324) established the product pattern
 * in tag-manager.tsx: `e.preventDefault()` suppresses the auto-close,
 * the handler is awaited, and the dialog is dismissed explicitly when
 * the action settles — so in-flight spinners / "Deleting…" labels are
 * actually reachable and ESC / overlay / Cancel can be made inert
 * mid-flight. Cycle 16 found five sibling dialogs that never received
 * the pattern (image-manager ×2, admin-user-manager, topic-manager
 * ×2, sales-client) — their in-flight UI was dead code.
 *
 * This fixture makes the pattern self-enforcing: every
 * `<AlertDialogAction` opening that carries an `onClick` handler MUST
 * either call `preventDefault(` inside that handler's opening-tag
 * expression, or be explicitly exempted with a comment containing
 * `@alert-dialog-auto-close-ok: <reason>` within the six lines above
 * the tag. Actions WITHOUT onClick (pure dismiss buttons) are fine —
 * the Radix auto-close is exactly what they want.
 *
 * Documented exemption: admin/db/page.tsx's restore confirm is a pure
 * confirm gate — the 250 MB restore upload runs under
 * startTransition with page-level progress UI, and holding the modal
 * open for that window would be worse than closing it.
 */

const srcRoot = path.resolve(__dirname, '..');

const SCAN_ROOTS: ReadonlyArray<string> = [
    path.resolve(srcRoot, 'components'),
    path.resolve(srcRoot, 'app'),
];

/** The primitive itself defines the component; it is not a consumer. */
const EXCLUDED_FILES = new Set<string>([
    path.resolve(srcRoot, 'components', 'ui', 'alert-dialog.tsx'),
]);

const EXEMPT_MARKER = '@alert-dialog-auto-close-ok:';
const TAG = '<AlertDialogAction';

interface Violation {
    file: string;
    line: number;
    snippet: string;
}

function collectTsxFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectTsxFiles(full, out);
        } else if (/\.(tsx|jsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Extract the full JSX opening tag starting at `start` (the index of
 * `<AlertDialogAction`). Walks forward balancing JSX expression braces
 * and string/template literals so a `>` inside an arrow function or a
 * string does not terminate the scan early. Returns the substring from
 * the tag start through its closing `>` (inclusive).
 */
function extractOpeningTag(source: string, start: number): string {
    let braceDepth = 0;
    let inString: '"' | "'" | '`' | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const prev = source[i - 1];
        if (inString) {
            if (ch === inString && prev !== '\\') inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
            continue;
        }
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
        else if (ch === '>' && braceDepth === 0) {
            return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

function lineOfIndex(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
}

function hasExemptMarker(source: string, tagIndex: number): boolean {
    const tagLine = lineOfIndex(source, tagIndex);
    const lines = source.split('\n');
    const from = Math.max(0, tagLine - 7); // six lines above the tag
    return lines.slice(from, tagLine).some((l) => l.includes(EXEMPT_MARKER));
}

function scanFile(file: string): Violation[] {
    const source = fs.readFileSync(file, 'utf8');
    const violations: Violation[] = [];
    let idx = source.indexOf(TAG);
    while (idx !== -1) {
        const opening = extractOpeningTag(source, idx);
        const hasOnClick = /\bonClick\s*=\s*\{/.test(opening);
        const callsPreventDefault = opening.includes('preventDefault(');
        if (hasOnClick && !callsPreventDefault && !hasExemptMarker(source, idx)) {
            violations.push({
                file: path.relative(srcRoot, file),
                line: lineOfIndex(source, idx),
                snippet: opening.replace(/\s+/g, ' ').slice(0, 160),
            });
        }
        idx = source.indexOf(TAG, idx + TAG.length);
    }
    return violations;
}

describe('AlertDialogAction settle-before-close lock (COR-R4C16-01)', () => {
    it('every onClick-bearing AlertDialogAction calls preventDefault() or carries the auto-close-ok marker', () => {
        const files = SCAN_ROOTS.flatMap((root) => collectTsxFiles(root))
            .filter((f) => !EXCLUDED_FILES.has(f));

        const violations = files.flatMap((f) => scanFile(f));

        const message = violations
            .map((v) => `${v.file}:${v.line} — ${v.snippet}`)
            .join('\n');

        expect(violations, `AlertDialogAction handlers that auto-close mid-flight (add e.preventDefault() + await per tag-manager.tsx DES-R4C14-B, or document with ${EXEMPT_MARKER} <reason>):\n${message}`).toEqual([]);
    });

    it('the tag-manager reference implementation stays on the pattern (regression canary)', () => {
        const tagManager = fs.readFileSync(
            path.resolve(srcRoot, 'app', '[locale]', 'admin', '(protected)', 'tags', 'tag-manager.tsx'),
            'utf8',
        );
        expect(tagManager).toContain('preventDefault()');
    });

    it('exactly one documented auto-close exemption exists (db restore confirm gate)', () => {
        const files = SCAN_ROOTS.flatMap((root) => collectTsxFiles(root))
            .filter((f) => !EXCLUDED_FILES.has(f));
        const markerFiles = files.filter((f) => fs.readFileSync(f, 'utf8').includes(EXEMPT_MARKER));
        expect(markerFiles.map((f) => path.relative(srcRoot, f))).toEqual([
            path.join('app', '[locale]', 'admin', '(protected)', 'db', 'page.tsx'),
        ]);
    });
});
