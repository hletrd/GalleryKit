/**
 * CI check: verifies all /api/admin/ route files export HTTP handlers wrapped
 * directly with withAdminAuth(...).
 * Run with: npx tsx scripts/check-api-auth.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_ADMIN_DIR = path.resolve(__dirname, '../src/app/api/admin');

// C5R-RPL-02: accept every route file extension Next.js 16 resolves,
// not just `.ts` / `.js`. Next.js 16 App Router accepts `route.tsx`,
// `route.mjs`, and `route.cjs` identically — failing to discover them
// means new route files in those formats would evade the withAdminAuth
// lint gate.
const ROUTE_FILE_NAMES = new Set([
    'route.ts',
    'route.tsx',
    'route.js',
    'route.mjs',
    'route.cjs',
]);

function findRouteFiles(dir: string): string[] {
    const results: string[] = [];
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

const HTTP_METHOD_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (
        ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isSatisfiesExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

function getLineNumber(sourceFile: ts.SourceFile, node: ts.Node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function variableUsesWithAdminAuth(initializer: ts.Expression | undefined): boolean {
    if (!initializer) return false;
    const unwrapped = unwrapExpression(initializer);
    if (!ts.isCallExpression(unwrapped)) {
        return false;
    }

    const callee = unwrapExpression(unwrapped.expression);
    return ts.isIdentifier(callee) && callee.text === 'withAdminAuth';
}

type RouteCheckReport = {
    passed: string[];
    failed: string[];
};

/**
 * C5R-RPL-02 / AGG5R-06 — core scanner logic exposed as a pure function for
 * unit tests (see `apps/web/src/__tests__/check-api-auth.test.ts`). Returns a
 * per-file outcome report instead of mutating global state so tests can
 * assert exact outcomes.
 */
export function checkRouteSource(content: string, relative: string = 'route.ts'): RouteCheckReport {
    const report: RouteCheckReport = { passed: [], failed: [] };
    // ts.ScriptKind must match the extension so JSX / module variants parse.
    let scriptKind: ts.ScriptKind = ts.ScriptKind.TS;
    if (relative.endsWith('.tsx')) {
        scriptKind = ts.ScriptKind.TSX;
    } else if (relative.endsWith('.js') || relative.endsWith('.mjs') || relative.endsWith('.cjs')) {
        scriptKind = ts.ScriptKind.JS;
    }
    const sourceFile = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, scriptKind);
    let sawHandlerExport = false;
    let fileHadFailure = false;

    for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || !HTTP_METHOD_EXPORTS.has(declaration.name.text)) {
                    continue;
                }

                sawHandlerExport = true;
                if (!variableUsesWithAdminAuth(declaration.initializer)) {
                    report.failed.push(`MISSING AUTH: ${relative}:${getLineNumber(sourceFile, declaration)} must export ${declaration.name.text} = withAdminAuth(...)`);
                    fileHadFailure = true;
                }
            }
            continue;
        }

        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && HTTP_METHOD_EXPORTS.has(statement.name.text)) {
            sawHandlerExport = true;
            report.failed.push(`MISSING AUTH: ${relative}:${getLineNumber(sourceFile, statement)} must export ${statement.name.text} via withAdminAuth(...)`);
            fileHadFailure = true;
        }
    }

    if (!sawHandlerExport) {
        report.failed.push(`MISSING AUTH: ${relative} does not export any HTTP handlers`);
        return report;
    }

    if (!fileHadFailure) {
        report.passed.push(`OK: ${relative}`);
    }

    return report;
}

function checkRouteFile(file: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    const report = checkRouteSource(content, relative);

    for (const line of report.passed) console.log(line);
    for (const line of report.failed) console.error(line);
    return report.failed.length > 0;
}

// CLI entrypoint — only runs when this file is executed directly via tsx.
// Guarded so the unit test can import checkRouteSource without side effects.
const isCliEntry = require.main === module || (typeof require === 'undefined' && import.meta?.url?.includes('check-api-auth'));
if (isCliEntry) {
    const routeFiles = findRouteFiles(API_ADMIN_DIR);
    if (routeFiles.length === 0) {
        console.log('No admin API route files found — skipping check.');
        process.exit(0);
    }

    let failed = false;
    for (const file of routeFiles) {
        if (checkRouteFile(file)) {
            failed = true;
        }
    }

    process.exit(failed ? 1 : 0);
}
