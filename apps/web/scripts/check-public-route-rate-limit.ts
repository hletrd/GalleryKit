/* SECURITY-CRITICAL: this lint gate enforces that every PUBLIC API
 * route file (i.e. NOT an admin API/private admin route) which exports a mutating
 * HTTP handler (POST/PUT/PATCH/DELETE) either:
 *   (a) carries an explicit `@public-no-rate-limit-required: <reason>`
 *       comment, OR
 *   (b) calls one of the documented rate-limit pre-increment helpers
 *       from `@/lib/rate-limit`.
 *
 * Expensive GET handlers are also scanned. A public GET route that imports or
 * calls DB/image/filesystem/embedding work must either call an approved
 * rate-limit helper or opt out with `@public-no-rate-limit-required: <reason>`.
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

const APP_DIR = path.resolve(__dirname, '../src/app');
const ADMIN_PREFIX = path.resolve(__dirname, '../src/app/api/admin') + path.sep;
const ADMIN_ROUTE_SEGMENT = `${path.sep}admin${path.sep}`;

const ROUTE_FILE_NAMES = new Set([
    'route.ts',
    'route.tsx',
    'route.js',
    'route.mjs',
    'route.cjs',
]);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXPENSIVE_GET_METHOD = 'GET';

// Recognized rate-limit invocation shapes. The helper must be imported from an
// approved rate-limit module; a local/noop function with the same prefix does
// not satisfy this gate.
const RATE_LIMIT_NAME_PREFIXES = ['preIncrement', 'checkAndIncrement'];
const APPROVED_RATE_LIMIT_MODULES = new Set(['@/lib/rate-limit', '@/lib/auth-rate-limit']);

const EXEMPT_TAG = '@public-no-rate-limit-required';
const EXEMPT_COMMENT_RE = /(?:^|[\s/*])@public-no-rate-limit-required:[^\S\r\n]*\S/;

const MUTATING_CALL_METHOD_NAMES = new Set([
    'insert',
    'update',
    'delete',
    'transaction',
    'query',
    'execute',
]);

const IMPORTED_SIDE_EFFECT_NAME_RE = /^(?:delete|remove|insert|update|write|enqueue|settle|cleanup|log|revalidate|track|mark|begin|end|resume|quiesce|drain|flush|acquire|release|restore|dump)(?:[A-Z_]|$)/i;

const EXPENSIVE_GET_MARKERS = [
    'ImageResponse',
    'serveUploadFile',
    'pickFirstAvailablePhotoBuffer',
    'embedText',
    'embedImage',
    'imageEmbeddings',
    'getGalleryConfig',
    'getSeoSettings',
    'getImage',
    'getMapImages',
    'getTimeline',
    'db.',
    'readFile',
    'createReadStream',
    'sharp',
];

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

function isPublicRouteFile(file: string): boolean {
    const resolved = path.resolve(file);
    if (resolved.startsWith(ADMIN_PREFIX)) return false;
    if (resolved.includes(ADMIN_ROUTE_SEGMENT)) return false;
    return true;
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

function collectApprovedRateLimitImports(sourceFile: ts.SourceFile): Set<string> {
    const approved = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !APPROVED_RATE_LIMIT_MODULES.has(statement.moduleSpecifier.text)
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            const localName = element.name.text;
            if (RATE_LIMIT_NAME_PREFIXES.some((prefix) => importedName.startsWith(prefix))) {
                approved.add(localName);
            }
        }
    }
    return approved;
}

function collectImportedSideEffectFunctionNames(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;

        const defaultName = statement.importClause.name?.text;
        if (defaultName && IMPORTED_SIDE_EFFECT_NAME_RE.test(defaultName)) {
            names.add(defaultName);
        }

        const bindings = statement.importClause.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (IMPORTED_SIDE_EFFECT_NAME_RE.test(importedName)) {
                names.add(element.name.text);
            }
        }
    }
    return names;
}

function isRateLimitHelperCall(node: ts.CallExpression, approvedRateLimitImports: Set<string>): boolean {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return false;
    return approvedRateLimitImports.has(callee.text);
}

function isKnownMutationCall(node: ts.CallExpression, importedSideEffectFunctionNames: Set<string> = new Set()): boolean {
    const callee = node.expression;
    return (ts.isPropertyAccessExpression(callee) && MUTATING_CALL_METHOD_NAMES.has(callee.name.text))
        || (ts.isIdentifier(callee) && importedSideEffectFunctionNames.has(callee.text));
}

function bodyCallsRateLimitBeforeMutation(
    body: ts.Node | undefined,
    approvedRateLimitImports: Set<string>,
    localMutatingFunctions: Set<string> = new Set(),
    importedSideEffectFunctionNames: Set<string> = new Set(),
): boolean {
    if (!body) return false;

    let sawRateLimitGate = false;
    let sawMutation = false;
    const rateLimitResultNames = new Set<string>();

    const inspectExpression = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            if (
                isKnownMutationCall(node, importedSideEffectFunctionNames)
                || (ts.isIdentifier(node.expression) && localMutatingFunctions.has(node.expression.text))
            ) {
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
            if (ts.isCallExpression(current) && isRateLimitHelperCall(current, approvedRateLimitImports)) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
    };

    const conditionReturnsEarly = (statement: ts.Statement): boolean => {
        if (ts.isReturnStatement(statement)) return true;
        if (ts.isBlock(statement)) return statement.statements.some(ts.isReturnStatement);
        return false;
    };

    const expressionChecksRateLimitResult = (node: ts.Node): boolean => {
        let found = false;
        const visit = (current: ts.Node) => {
            if (found) return;
            if (ts.isFunctionLike(current)) return;
            if (ts.isIdentifier(current) && rateLimitResultNames.has(current.text)) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
    };

    const statementHasRateLimitGate = (statement: ts.Statement): boolean => {
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (
                    ts.isIdentifier(decl.name)
                    && decl.initializer
                    && expressionHasTopLevelRateLimit(decl.initializer)
                ) {
                    rateLimitResultNames.add(decl.name.text);
                }
            }
            return false;
        }
        if (ts.isIfStatement(statement)) {
            // The helper result must dominate subsequent mutation by returning
            // early on over-limit. A bare helper call is not enough.
            return (
                (expressionHasTopLevelRateLimit(statement.expression) || expressionChecksRateLimitResult(statement.expression))
                && conditionReturnsEarly(statement.thenStatement)
            );
        }
        return false;
    };

    const inspectStatement = (statement: ts.Statement) => {
        let statementHasMutation = false;
        const visit = (node: ts.Node) => {
            if (ts.isFunctionLike(node) && node !== statement) return;
            if (ts.isCallExpression(node)) {
                if (
                    isKnownMutationCall(node, importedSideEffectFunctionNames)
                    || (ts.isIdentifier(node.expression) && localMutatingFunctions.has(node.expression.text))
                ) statementHasMutation = true;
            }
            ts.forEachChild(node, visit);
        };
        visit(statement);
        if (statementHasMutation && !sawRateLimitGate) {
            sawMutation = true;
        }
        if (statementHasRateLimitGate(statement)) {
            sawRateLimitGate = true;
        }
    };

    if (ts.isBlock(body)) {
        for (const statement of body.statements) {
            inspectStatement(statement);
        }
    } else {
        inspectExpression(body);
    }

    return sawRateLimitGate && !sawMutation;
}

function bodyCallsApprovedRateLimit(body: ts.Node | undefined, approvedRateLimitImports: Set<string>): boolean {
    if (!body) return false;
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== body) return;
        if (ts.isCallExpression(node) && isRateLimitHelperCall(node, approvedRateLimitImports)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
}

function bodyCallsRateLimitBeforeExpensiveGetWork(
    body: ts.Node | undefined,
    approvedRateLimitImports: Set<string>,
    sourceFile: ts.SourceFile,
    localExpensiveGetFunctions: Set<string>,
): boolean {
    if (!body) return false;

    let sawRateLimitGate = false;
    const rateLimitResultNames = new Set<string>();

    const expressionHasTopLevelRateLimit = (node: ts.Node): boolean => {
        let found = false;
        const visit = (current: ts.Node) => {
            if (found) return;
            if (ts.isFunctionLike(current)) return;
            if (ts.isCallExpression(current) && isRateLimitHelperCall(current, approvedRateLimitImports)) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
    };

    const conditionReturnsEarly = (statement: ts.Statement): boolean => {
        if (ts.isReturnStatement(statement)) return true;
        if (ts.isBlock(statement)) return statement.statements.some(ts.isReturnStatement);
        return false;
    };

    const expressionChecksRateLimitResult = (node: ts.Node): boolean => {
        let found = false;
        const visit = (current: ts.Node) => {
            if (found) return;
            if (ts.isFunctionLike(current)) return;
            if (ts.isIdentifier(current) && rateLimitResultNames.has(current.text)) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
    };

    const statementHasRateLimitGate = (statement: ts.Statement): boolean => {
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (
                    ts.isIdentifier(decl.name)
                    && decl.initializer
                    && expressionHasTopLevelRateLimit(decl.initializer)
                ) {
                    rateLimitResultNames.add(decl.name.text);
                }
            }
            return false;
        }
        if (ts.isIfStatement(statement)) {
            return (
                (expressionHasTopLevelRateLimit(statement.expression) || expressionChecksRateLimitResult(statement.expression))
                && conditionReturnsEarly(statement.thenStatement)
            );
        }
        return false;
    };

    const nodeContainsExpensiveWork = (node: ts.Node | undefined): boolean => {
        return bodyContainsExpensiveGetWork(node, sourceFile, localExpensiveGetFunctions);
    };

    const statementContainsExpensiveWork = (statement: ts.Statement): boolean => {
        return nodeContainsExpensiveWork(statement);
    };

    const inspectStatements = (statements: ts.NodeArray<ts.Statement>): boolean => {
        for (const statement of statements) {
            if (ts.isTryStatement(statement)) {
                const gateBeforeTry = sawRateLimitGate;
                if (
                    !gateBeforeTry
                    && (
                        nodeContainsExpensiveWork(statement.catchClause?.block)
                        || nodeContainsExpensiveWork(statement.finallyBlock)
                    )
                ) {
                    return false;
                }
                if (!inspectStatements(statement.tryBlock.statements)) {
                    return false;
                }
                if (gateBeforeTry && statement.catchClause && !inspectStatements(statement.catchClause.block.statements)) {
                    return false;
                }
                if (gateBeforeTry && statement.finallyBlock && !inspectStatements(statement.finallyBlock.statements)) {
                    return false;
                }
                continue;
            }
            if (!sawRateLimitGate && statementContainsExpensiveWork(statement)) {
                return false;
            }
            if (statementHasRateLimitGate(statement)) {
                sawRateLimitGate = true;
            }
        }
        return sawRateLimitGate;
    };

    if (ts.isBlock(body)) {
        return inspectStatements(body.statements);
    }

    return bodyCallsApprovedRateLimit(body, approvedRateLimitImports);
}

function bodyContainsExpensiveGetWork(
    body: ts.Node | undefined,
    sourceFile: ts.SourceFile,
    localExpensiveGetFunctions: Set<string> = new Set(),
): boolean {
    if (!body) return false;
    const text = body.getText(sourceFile);
    if (EXPENSIVE_GET_MARKERS.some((marker) => text.includes(marker))) {
        return true;
    }

    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== body) return;
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && localExpensiveGetFunctions.has(node.expression.text)
        ) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
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
    const approvedRateLimitImports = collectApprovedRateLimitImports(sourceFile);
    const importedSideEffectFunctionNames = collectImportedSideEffectFunctionNames(sourceFile);

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
    const localMutatingFunctions = new Set<string>();
    let mutatingSetChanged = true;
    while (mutatingSetChanged) {
        mutatingSetChanged = false;
        for (const [name, body] of localBodies) {
            if (!body || localMutatingFunctions.has(name)) continue;
            let containsMutation = false;
            const visit = (node: ts.Node) => {
                if (containsMutation) return;
                if (ts.isFunctionLike(node) && node !== body) return;
                if (ts.isCallExpression(node)) {
                    const callee = node.expression;
                    if (
                        isKnownMutationCall(node, importedSideEffectFunctionNames)
                        || (ts.isIdentifier(callee) && localMutatingFunctions.has(callee.text))
                    ) {
                        containsMutation = true;
                        return;
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(body);
            if (containsMutation) {
                localMutatingFunctions.add(name);
                mutatingSetChanged = true;
            }
        }
    }

    const localExpensiveGetFunctions = new Set<string>();
    let expensiveGetSetChanged = true;
    while (expensiveGetSetChanged) {
        expensiveGetSetChanged = false;
        for (const [name, body] of localBodies) {
            if (!body || localExpensiveGetFunctions.has(name)) continue;
            if (bodyContainsExpensiveGetWork(body, sourceFile, localExpensiveGetFunctions)) {
                localExpensiveGetFunctions.add(name);
                expensiveGetSetChanged = true;
            }
        }
    }

    const mutatingHandlers: HandlerBody[] = [];
    const getHandlers: HandlerBody[] = [];
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
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            if (MUTATING_METHODS.has(statement.name.text)) {
                mutatingHandlers.push({ method: statement.name.text, body: statement.body });
            } else if (statement.name.text === EXPENSIVE_GET_METHOD) {
                getHandlers.push({ method: statement.name.text, body: statement.body });
            }
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
                } else if (
                    ts.isIdentifier(decl.name)
                    && decl.name.text === EXPENSIVE_GET_METHOD
                    && isFunctionLikeInitializer(decl.initializer)
                ) {
                    getHandlers.push({ method: decl.name.text, body: expressionBody(decl.initializer) });
                }
            }
        }
        // C1-BUG-02: handle export-specifier form: export { handler as POST }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (ts.isIdentifier(element.name) && MUTATING_METHODS.has(element.name.text)) {
                    const localName = element.propertyName?.text ?? element.name.text;
                    mutatingHandlers.push({ method: element.name.text, body: localBodies.get(localName) });
                } else if (ts.isIdentifier(element.name) && element.name.text === EXPENSIVE_GET_METHOD) {
                    if (statement.moduleSpecifier) {
                        report.failed.push(
                            `UNSUPPORTED GET RE-EXPORT: ${relative} re-exports GET from another module, which hides expensive work from this scanner. Export a local handler body or add a reasoned '${EXEMPT_TAG}: <reason>' comment.`,
                        );
                        continue;
                    }
                    const localName = element.propertyName?.text ?? element.name.text;
                    getHandlers.push({ method: element.name.text, body: localBodies.get(localName) });
                }
            }
        }
    }

    // Check for explicit reasoned exempt comment.
    // C1-BUG-05: strip string literals before matching so the tag inside
    // a string literal does not falsely exempt the file.
    const withoutStrings = content
        .replace(/`[^`]*`/g, '')
        .replace(/"[^"]*"/g, '')
        .replace(/'[^']*'/g, '');
    const hasExemption = EXEMPT_COMMENT_RE.test(withoutStrings);
    if (hasExemption) {
        const protectedSurfaceCount = mutatingHandlers.length + getHandlers.filter((handler) => bodyContainsExpensiveGetWork(handler.body, sourceFile, localExpensiveGetFunctions)).length;
        if (protectedSurfaceCount > 1) {
            report.failed.push(
                `AMBIGUOUS RATE-LIMIT EXEMPTION: ${relative} exports protected handlers ${[...mutatingHandlers, ...getHandlers.filter((handler) => bodyContainsExpensiveGetWork(handler.body, sourceFile, localExpensiveGetFunctions))].map((handler) => handler.method).join(', ')} and carries a file-level '${EXEMPT_TAG}: <reason>'. Move the exemption into a single-handler route file or rate-limit every non-exempt protected handler.`,
            );
            return report;
        }
        report.passed.push(`OK: ${relative} (carries ${EXEMPT_TAG})`);
    }

    if (mutatingHandlers.length > 0 && hasExemption) {
        return report;
    }

    if (mutatingHandlers.length > 0 && mutatingHandlers.every((handler) => bodyCallsRateLimitBeforeMutation(
        handler.body,
        approvedRateLimitImports,
        localMutatingFunctions,
        importedSideEffectFunctionNames,
    ))) {
        report.passed.push(`OK: ${relative} (uses rate-limit helper)`);
    } else if (mutatingHandlers.length > 0) {
        report.failed.push(
            `MISSING RATE LIMIT: ${relative} exports mutating handler(s) ${mutatingHandlers.map((handler) => handler.method).join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit pre-increment helper before mutation (preIncrement* / checkAndIncrement*).`
        );
    }

    const expensiveGetHandlers = getHandlers.filter((handler) => bodyContainsExpensiveGetWork(handler.body, sourceFile, localExpensiveGetFunctions));
    if (expensiveGetHandlers.length > 0 && !hasExemption) {
        const unmeteredGetHandlers = expensiveGetHandlers.filter((handler) => !bodyCallsRateLimitBeforeExpensiveGetWork(handler.body, approvedRateLimitImports, sourceFile, localExpensiveGetFunctions));
        if (unmeteredGetHandlers.length > 0) {
            report.failed.push(
                `MISSING RATE LIMIT: ${relative} exports expensive GET handler(s) ${unmeteredGetHandlers.map((handler) => handler.method).join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit pre-increment helper before expensive work.`
            );
        } else {
            report.passed.push(`OK: ${relative} (expensive GET uses rate-limit helper)`);
        }
    }

    if (mutatingHandlers.length === 0 && expensiveGetHandlers.length === 0 && !hasExemption) {
        report.passed.push(`OK: ${relative} (no mutating or expensive GET handlers)`);
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
    const allRoutes = findRouteFiles(APP_DIR).filter(isPublicRouteFile);
    if (allRoutes.length === 0) {
        console.error(`No public route files found under ${APP_DIR}; route discovery likely broke.`);
        process.exit(1);
    }
    let failed = false;
    for (const file of allRoutes) {
        if (checkRouteFile(file)) failed = true;
    }
    process.exit(failed ? 1 : 0);
}
