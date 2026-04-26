import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 1 RPF v3 TE-1 / A-2 seatbelt:
 *
 * Codify the WCAG 2.5.5 / Apple HIG / Google MDN 44 px touch-target
 * floor as a fixture-style guard so a future change cannot regress a
 * primary interactive surface to h-8 (32 px), h-9 (36 px), or shadcn
 * size="sm" (32 px) without an explicit, documented exemption.
 *
 * The audit walks `apps/web/src/components/` and a known-touch-primary
 * subset of `apps/web/src/app/` and asserts that the LIST OF KNOWN
 * VIOLATIONS is empty. This is a "punch-list" style test: when
 * intentionally adding a NEW < 44 px element, document the reason in
 * the EXEMPTIONS map below.
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
 * Files that intentionally render < 44 px elements with documented
 * reasons. New additions require a comment on the line documenting the
 * reason (e.g., "decorative icon inside larger flex parent",
 * "internal modal control where keyboard nav is primary").
 */
const EXEMPTIONS = new Set<string>([
    // The lightbox close/fullscreen/prev/next buttons render at h-10/w-10
    // INSIDE a larger pointer-events area (h-full w-16 hit zone for prev/
    // next; absolute-positioned for close/fullscreen). The visible icon is
    // smaller but the actual hit target via pointer-events:auto is larger.
    // Verified via DOM at gallery.atik.kr in designer-v2 review.
    'components/lightbox.tsx',
    // shadcn ui primitives are decorative wrappers; touch-target rule
    // applies at the consumer site, not the primitive.
    'components/ui/button.tsx',
    'components/ui/input.tsx',
    'components/ui/select.tsx',
    'components/ui/dropdown-menu.tsx',
    'components/ui/dialog.tsx',
    'components/ui/sheet.tsx',
    'components/ui/popover.tsx',
    'components/ui/card.tsx',
    'components/ui/checkbox.tsx',
    'components/ui/radio-group.tsx',
    'components/ui/textarea.tsx',
    'components/ui/label.tsx',
    'components/ui/tabs.tsx',
    'components/ui/badge.tsx',
    'components/ui/separator.tsx',
    'components/ui/scroll-area.tsx',
    'components/ui/alert.tsx',
    'components/ui/alert-dialog.tsx',
    'components/ui/sonner.tsx',
    'components/ui/skeleton.tsx',
    'components/ui/avatar.tsx',
    'components/ui/tooltip.tsx',
    'components/ui/switch.tsx',
    'components/ui/collapsible.tsx',
    'components/ui/accordion.tsx',
    'components/ui/progress.tsx',
    // photo-viewer-loading.tsx renders an h-8 w-8 SPINNER (decorative,
    // not interactive — aria-hidden="true").
    'components/photo-viewer-loading.tsx',
    // Admin internal surfaces: image-manager and admin-user-manager
    // render edit/delete buttons inside table rows where keyboard
    // tab order is primary. Tracked separately if mobile admin becomes
    // a priority. NOT in scope for cycle 1 RPF v3 (designer-v2 explicitly
    // excluded admin dashboard / upload flow).
    'components/image-manager.tsx',
    'components/admin-user-manager.tsx',
    'components/upload-dropzone.tsx',
    'components/admin-header.tsx',
    'components/photo-navigation.tsx',
]);

/**
 * Forbidden patterns that indicate a < 44 px touch target on a primary
 * interactive surface. Each pattern is paired with a description.
 */
const FORBIDDEN: Array<{ pattern: RegExp; description: string }> = [
    {
        pattern: /<Button\b[^>]*\bsize="sm"/,
        description: 'shadcn size="sm" maps to h-8 (32 px) — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName="[^"]*\bh-8\b/,
        description: '<Button className="...h-8..."> renders 32 px — below 44 px floor',
    },
    {
        pattern: /<Button\b[^>]*\bclassName="[^"]*\bh-9\b/,
        description: '<Button className="...h-9..."> renders 36 px — below 44 px floor',
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
    it('finds no < 44 px touch targets in non-exempt component files', () => {
        const files = listFilesRecursive(componentsDir, (f) => /\.(tsx|jsx)$/.test(f));
        const issues: FoundIssue[] = [];
        for (const f of files) {
            const rel = relPathFromSrc(f);
            if (EXEMPTIONS.has(rel)) continue;
            issues.push(...scanFile(f));
        }
        if (issues.length > 0) {
            const detail = issues
                .map((i) => `${i.file}:${i.line}  ${i.pattern}\n   ${i.snippet}`)
                .join('\n\n');
            throw new Error(
                `Found ${issues.length} touch-target violations:\n\n${detail}\n\n` +
                `Either fix the violation by raising to h-11 / min-h-[44px], or ` +
                `add the file to EXEMPTIONS in this test with a documented reason.`,
            );
        }
        expect(issues).toEqual([]);
    });

    it('finds no < 44 px touch targets in admin login form', () => {
        const loginForm = path.resolve(adminDir, '[locale]', 'admin', 'login-form.tsx');
        if (!fs.existsSync(loginForm)) return;
        const issues = scanFile(loginForm);
        expect(issues, `Login form should clear 44 px floor: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
    });
});
