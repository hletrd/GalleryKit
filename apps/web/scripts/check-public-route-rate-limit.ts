/* SECURITY-CRITICAL: this lint gate enforces that every PUBLIC API
 * route file (i.e. NOT under /api/admin/) which exports a mutating
 * HTTP handler (POST/PUT/PATCH/DELETE) either:
 *   (a) carries an explicit `@public-no-rate-limit-required: <reason>`
 *       comment, OR
 *   (b) calls one of the documented rate-limit pre-increment helpers
 *       from `@/lib/rate-limit`.
 *
 * Cycle 3 / D-101-15: closes the cycle 2 RPF C2RPF-CROSS-LOW-03 gap —
 * a future PR that adds a fourth public-mutating route must consciously
 * opt out of rate limiting (with a documented reason) or wire in the
 * Pattern 2 rollback helpers, instead of silently shipping an
 * unmetered public mutation surface.
 *
 * Run with: npx tsx scripts/check-public-route-rate-limit.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_DIR = path.resolve(__dirname, '../src/app/api');
const ADMIN_PREFIX = path.resolve(__dirname, '../src/app/api/admin') + path.sep;

const ROUTE_FILE_NAMES = new Set([
    'route.ts',
    'route.tsx',
    'route.js',
    'route.mjs',
    'route.cjs',
]);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Recognized rate-limit invocation shapes. We accept any helper whose
// name starts with `preIncrement` (the documented Pattern 2 shape) plus
// the bespoke helpers used by older route files (`checkAndIncrement…`).
// Future routes are expected to use the `preIncrement` shape, but we don't
// force a refactor on the existing code for this lint gate.
const RATE_LIMIT_NAME_PREFIXES = ['preIncrement', 'checkAndIncrement'];
const RATE_LIMIT_MODULE_HINTS = ['auth-rate-limit'];

const EXEMPT_TAG = '@public-no-rate-limit-required';

function findRouteFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findRouteFiles(full));
        } else if (ROUTE_FILE_NAMES.has(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

type CheckReport = {
    passed: string[];
    failed: string[];
};

export function checkPublicRouteSource(content: string, relative: string = 'route.ts'): CheckReport {
    const report: CheckReport = { passed: [], failed: [] };

    let scriptKind: ts.ScriptKind = ts.ScriptKind.TS;
    if (relative.endsWith('.tsx')) {
        scriptKind = ts.ScriptKind.TSX;
    } else if (relative.endsWith('.js') || relative.endsWith('.mjs') || relative.endsWith('.cjs')) {
        scriptKind = ts.ScriptKind.JS;
    }
    const sourceFile = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, scriptKind);

    // Find any exported mutating handler in the file
    const mutatingHandlers: string[] = [];
    for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        // ExportDeclaration (e.g. export { handler as POST }) is exported by definition
        const isExportDecl = ts.isExportDeclaration(statement);
        if (!isExported && !isExportDecl) continue;
        if (ts.isFunctionDeclaration(statement) && statement.name && MUTATING_METHODS.has(statement.name.text)) {
            mutatingHandlers.push(statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && MUTATING_METHODS.has(decl.name.text)) {
                    // C1-BUG-04: only flag variable exports whose initializer is
                    // function-like (arrow, function expression, or call wrapper).
                    const init = decl.initializer;
                    const isFunctionLike = init && (
                        ts.isArrowFunction(init) ||
                        ts.isFunctionExpression(init) ||
                        ts.isCallExpression(init)
                    );
                    if (isFunctionLike) {
                        mutatingHandlers.push(decl.name.text);
                    }
                }
            }
        }
        // C1-BUG-02: handle export-specifier form: export { handler as POST }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (ts.isIdentifier(element.name) && MUTATING_METHODS.has(element.name.text)) {
                    mutatingHandlers.push(element.name.text);
                }
            }
        }
    }

    if (mutatingHandlers.length === 0) {
        report.passed.push(`OK: ${relative} (no mutating handlers)`);
        return report;
    }

    // Check for explicit exempt comment anywhere in the file.
    // C1-BUG-05: strip string literals before matching so the tag inside
    // a string literal does not falsely exempt the file.
    const withoutStrings = content
        .replace(/`[^`]*`/g, '')
        .replace(/"[^"]*"/g, '')
        .replace(/'[^']*'/g, '');
    if (withoutStrings.includes(EXEMPT_TAG)) {
        report.passed.push(`OK: ${relative} (carries ${EXEMPT_TAG})`);
        return report;
    }

    // Check for any rate-limit helper invocation by name prefix.
    // C3-F02: scan the string-stripped content so a literal containing the
    // helper name does not falsely satisfy the gate.
    const usesPrefixHelper = RATE_LIMIT_NAME_PREFIXES.some((prefix) => {
        const re = new RegExp(`\\b${prefix}[A-Za-z0-9_]+\\s*\\(`);
        return re.test(withoutStrings);
    });
    const importsRateLimitModule = RATE_LIMIT_MODULE_HINTS.some((mod) => {
        const re = new RegExp(`from\\s+['\"]@/lib/${mod}['\"]`);
        return re.test(content);
    });

    if (usesPrefixHelper || importsRateLimitModule) {
        report.passed.push(`OK: ${relative} (uses rate-limit helper)`);
    } else {
        report.failed.push(
            `MISSING RATE LIMIT: ${relative} exports mutating handler(s) ${mutatingHandlers.join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit helper (preIncrement* / checkAndIncrement* / @/lib/auth-rate-limit).`
        );
    }

    return report;
}

function checkRouteFile(file: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    const report = checkPublicRouteSource(content, relative);
    for (const line of report.passed) console.log(line);
    for (const line of report.failed) console.error(line);
    return report.failed.length > 0;
}

const isCliEntry = require.main === module || (typeof require === 'undefined' && import.meta?.url?.includes('check-public-route-rate-limit'));
if (isCliEntry) {
    const allRoutes = findRouteFiles(API_DIR).filter((f) => !f.startsWith(ADMIN_PREFIX));
    if (allRoutes.length === 0) {
        console.log('No public API route files found — skipping check.');
        process.exit(0);
    }
    let failed = false;
    for (const file of allRoutes) {
        if (checkRouteFile(file)) failed = true;
    }
    process.exit(failed ? 1 : 0);
}
