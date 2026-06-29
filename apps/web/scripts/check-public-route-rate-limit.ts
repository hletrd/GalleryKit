/* SECURITY-CRITICAL: this lint gate enforces that every PUBLIC API
 * route file (i.e. NOT under /api/admin/) which exports a mutating
 * HTTP handler (POST/PUT/PATCH/DELETE) either:
 *   (a) carries an explicit `@public-no-rate-limit-required: <reason>`
 *       comment, OR
 *   (b) calls one of the documented rate-limit pre-increment helpers
 *       from `@/lib/rate-limit`.
 *
 * IMPORTANT: GET handlers are NOT scanned by this gate. Expensive GET
 * routes (e.g., ImageResponse, file generation) must be audited separately
 * or opt out with `@public-no-rate-limit-required: <reason>`.
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

const EXEMPT_TAG = '@public-no-rate-limit-required';

const MUTATING_CALL_METHOD_NAMES = new Set([
    'insert',
    'update',
    'delete',
    'transaction',
    'query',
    'execute',
]);

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

type HandlerBody = {
    method: string;
    body: ts.Node | undefined;
};

function isFunctionLikeInitializer(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression | ts.CallExpression {
    return Boolean(node && (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isCallExpression(node)
    ));
}

function expressionBody(node: ts.Expression | undefined): ts.Node | undefined {
    if (!node) return undefined;
    if (ts.isArrowFunction(node)) return node.body;
    if (ts.isFunctionExpression(node)) return node.body;
    if (ts.isCallExpression(node)) return node;
    return undefined;
}

function isRateLimitHelperCall(node: ts.CallExpression): boolean {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return false;
    return RATE_LIMIT_NAME_PREFIXES.some((prefix) => callee.text.startsWith(prefix));
}

function isKnownMutationCall(node: ts.CallExpression): boolean {
    const callee = node.expression;
    return ts.isPropertyAccessExpression(callee) && MUTATING_CALL_METHOD_NAMES.has(callee.name.text);
}

function bodyCallsRateLimitBeforeMutation(body: ts.Node | undefined): boolean {
    if (!body) return false;

    let sawRateLimit = false;
    let sawMutation = false;

    const inspectExpression = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            if (isRateLimitHelperCall(node)) {
                sawRateLimit = true;
            }
            if (isKnownMutationCall(node)) {
                sawMutation = true;
            }
        }
        ts.forEachChild(node, inspectExpression);
    };

    const expressionHasTopLevelRateLimit = (node: ts.Node): boolean => {
        let found = false;
        const visit = (current: ts.Node) => {
            if (found) return;
            if (ts.isFunctionLike(current)) return;
            if (ts.isCallExpression(current) && isRateLimitHelperCall(current)) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
    };

    const statementHasExecutedRateLimit = (statement: ts.Statement): boolean => {
        if (ts.isExpressionStatement(statement)) {
            return expressionHasTopLevelRateLimit(statement.expression);
        }
        if (ts.isVariableStatement(statement)) {
            return statement.declarationList.declarations.some((decl) => (
                decl.initializer ? expressionHasTopLevelRateLimit(decl.initializer) : false
            ));
        }
        if (ts.isIfStatement(statement)) {
            // Only the condition dominates the following statements. A helper
            // hidden in the then/else body may be unreachable or branch-only,
            // so it cannot satisfy the pre-mutation gate.
            return expressionHasTopLevelRateLimit(statement.expression);
        }
        if (ts.isReturnStatement(statement) && statement.expression) {
            return expressionHasTopLevelRateLimit(statement.expression);
        }
        return false;
    };

    const inspectStatement = (statement: ts.Statement) => {
        let statementHasMutation = false;
        const visit = (node: ts.Node) => {
            if (ts.isFunctionLike(node) && node !== statement) return;
            if (ts.isCallExpression(node)) {
                if (isKnownMutationCall(node)) statementHasMutation = true;
            }
            ts.forEachChild(node, visit);
        };
        visit(statement);
        if (statementHasMutation && !sawRateLimit) {
            sawMutation = true;
        }
        if (statementHasExecutedRateLimit(statement)) {
            sawRateLimit = true;
        }
    };

    if (ts.isBlock(body)) {
        for (const statement of body.statements) {
            inspectStatement(statement);
        }
    } else {
        inspectExpression(body);
    }

    return sawRateLimit && !sawMutation;
}

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
    const localBodies = new Map<string, ts.Node | undefined>();
    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            localBodies.set(statement.name.text, statement.body);
            continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !isFunctionLikeInitializer(decl.initializer)) continue;
            localBodies.set(decl.name.text, expressionBody(decl.initializer));
        }
    }

    const mutatingHandlers: HandlerBody[] = [];
    for (const statement of sourceFile.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        const isExported = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        // ExportDeclaration (e.g. export { handler as POST }) is exported by definition
        const isExportDecl = ts.isExportDeclaration(statement);
        if (!isExported && !isExportDecl) continue;
        // OBS-R4C19-C: `export * from './impl'` re-exports every named export
        // of the target module — including mutating handlers this scanner
        // cannot see. check-api-auth fails closed on the same shape ("does
        // not export any HTTP handlers"); mirror that posture here instead
        // of silently passing the file as "no mutating handlers".
        if (ts.isExportDeclaration(statement) && !statement.exportClause && statement.moduleSpecifier) {
            report.failed.push(
                `STAR RE-EXPORT: ${relative} uses 'export * from …', which hides handler exports from this scanner. Re-export handlers by name so the rate-limit gate can audit them.`
            );
            return report;
        }
        if (ts.isFunctionDeclaration(statement) && statement.name && MUTATING_METHODS.has(statement.name.text)) {
            mutatingHandlers.push({ method: statement.name.text, body: statement.body });
        }
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && MUTATING_METHODS.has(decl.name.text)) {
                    // C1-BUG-04: only flag variable exports whose initializer is
                    // function-like (arrow, function expression, or call wrapper).
                    const init = decl.initializer;
                    if (isFunctionLikeInitializer(init)) {
                        mutatingHandlers.push({ method: decl.name.text, body: expressionBody(init) });
                    }
                }
            }
        }
        // C1-BUG-02: handle export-specifier form: export { handler as POST }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (ts.isIdentifier(element.name) && MUTATING_METHODS.has(element.name.text)) {
                    const localName = element.propertyName?.text ?? element.name.text;
                    mutatingHandlers.push({ method: element.name.text, body: localBodies.get(localName) });
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

    if (mutatingHandlers.every((handler) => bodyCallsRateLimitBeforeMutation(handler.body))) {
        report.passed.push(`OK: ${relative} (uses rate-limit helper)`);
    } else {
        report.failed.push(
            `MISSING RATE LIMIT: ${relative} exports mutating handler(s) ${mutatingHandlers.map((handler) => handler.method).join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit pre-increment helper before mutation (preIncrement* / checkAndIncrement*).`
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

const isCliEntry = (typeof require !== 'undefined' && require.main === module) || (typeof require === 'undefined' && import.meta?.url?.includes('check-public-route-rate-limit'));
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
