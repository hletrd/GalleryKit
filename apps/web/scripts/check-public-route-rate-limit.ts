/* SECURITY-CRITICAL: this lint gate enforces that every PUBLIC API
 * route file (i.e. NOT an admin API/private admin route) which exports a mutating
 * HTTP handler (POST/PUT/PATCH/DELETE) either:
 *   (a) carries an explicit `@public-no-rate-limit-required: <reason>`
 *       comment, OR
 *   (b) calls one of the documented rate-limit pre-increment helpers
 *       from `@/lib/rate-limit`.
 *
 * Expensive GET/HEAD handlers are also scanned. A public read route that imports or
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
const EXPENSIVE_READ_METHODS = new Set(['GET', 'HEAD']);

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

const IMPORTED_SIDE_EFFECT_NAME_RE = /^(?:create|delete|remove|insert|update|upsert|write|enqueue|settle|cleanup|log|revalidate|track|mark|begin|end|resume|quiesce|drain|flush|acquire|release|revoke|issue|mint|rotate|restore|dump)(?:[A-Z_]|$)/i;

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

const EXPENSIVE_READ_IMPORT_MODULES = new Set([
    '@/db',
    '@/lib/analytics-data',
    '@/lib/clip-inference',
    '@/lib/clip-model',
    '@/lib/data',
    '@/lib/data-timeline',
    '@/lib/gallery-config',
    '@/lib/og-photo-fetch',
    '@/lib/serve-upload',
    'fs',
    'fs/promises',
    'node:fs',
    'node:fs/promises',
    'sharp',
]);

const EXPENSIVE_READ_MODULE_PATHS = new Set([
    'src/db',
    'src/lib/analytics-data',
    'src/lib/clip-inference',
    'src/lib/clip-model',
    'src/lib/data',
    'src/lib/data-timeline',
    'src/lib/gallery-config',
    'src/lib/og-photo-fetch',
    'src/lib/serve-upload',
]);

type ImportedExpensiveReadFunctions = {
    identifiers: Set<string>;
    namespaces: Set<string>;
    propertyRoots: Set<string>;
};

const emptyImportedExpensiveReadFunctions = (): ImportedExpensiveReadFunctions => ({
    identifiers: new Set(),
    namespaces: new Set(),
    propertyRoots: new Set(),
});

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
    shadowsApprovedRateLimit: boolean;
};

type FunctionBodyInfo = {
    body: ts.Node | undefined;
    parameters: readonly ts.ParameterDeclaration[];
};

function bindingNameIntersects(name: ts.BindingName, candidates: Set<string>): boolean {
    if (ts.isIdentifier(name)) {
        return candidates.has(name.text);
    }
    return name.elements.some((element) => {
        return ts.isBindingElement(element) && bindingNameIntersects(element.name, candidates);
    });
}

function parametersIntersect(parameters: readonly ts.ParameterDeclaration[], candidates: Set<string>): boolean {
    return parameters.some((parameter) => bindingNameIntersects(parameter.name, candidates));
}

function bodyDeclaresBindingName(body: ts.Node | undefined, candidates: Set<string>): boolean {
    if (!body) return false;
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionDeclaration(node) && node.name && candidates.has(node.name.text)) {
            found = true;
            return;
        }
        if (ts.isVariableDeclaration(node) && bindingNameIntersects(node.name, candidates)) {
            found = true;
            return;
        }
        if (node !== body && ts.isFunctionLike(node)) {
            if (parametersIntersect(node.parameters, candidates)) {
                found = true;
            }
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
}

function functionInfoShadowsName(info: FunctionBodyInfo | undefined, candidates: Set<string>): boolean {
    if (!info || candidates.size === 0) return false;
    return parametersIntersect(info.parameters, candidates) || bodyDeclaresBindingName(info.body, candidates);
}

function isFunctionLikeInitializer(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression | ts.CallExpression {
    return Boolean(node && (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isCallExpression(node)
    ));
}

function functionInfoFromInitializer(node: ts.Expression | undefined): FunctionBodyInfo | undefined {
    if (!node) return undefined;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        return { body: node.body, parameters: [...node.parameters] };
    }
    if (ts.isCallExpression(node)) {
        return { body: node, parameters: [] };
    }
    return undefined;
}

function handlerBodyFromExportedVariable(
    initializer: ts.Expression | undefined,
    localBodies: Map<string, FunctionBodyInfo>,
    approvedRateLimitImports: Set<string>,
): { body: ts.Node | undefined; unsupportedAlias: string | null; shadowsApprovedRateLimit: boolean } | null {
    const directInfo = functionInfoFromInitializer(initializer);
    if (directInfo) {
        return {
            body: directInfo.body,
            unsupportedAlias: null,
            shadowsApprovedRateLimit: functionInfoShadowsName(directInfo, approvedRateLimitImports),
        };
    }
    if (initializer && ts.isIdentifier(initializer)) {
        const localInfo = localBodies.get(initializer.text);
        if (localInfo) {
            return {
                body: localInfo.body,
                unsupportedAlias: null,
                shadowsApprovedRateLimit: functionInfoShadowsName(localInfo, approvedRateLimitImports),
            };
        }
        return { body: undefined, unsupportedAlias: initializer.text, shadowsApprovedRateLimit: false };
    }
    return null;
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

function stripModuleExtension(target: string): string {
    return target
        .replace(/\.(?:[cm]?[jt]sx?)$/, '')
        .replace(/\/index$/, '');
}

function normalizeModuleSpecifier(moduleSpecifier: string, relative: string): string {
    if (moduleSpecifier.startsWith('@/')) {
        return stripModuleExtension(`src/${moduleSpecifier.slice(2)}`);
    }
    if (!moduleSpecifier.startsWith('.')) {
        return stripModuleExtension(moduleSpecifier);
    }
    const sourceDir = path.posix.dirname(relative.replace(/\\/g, '/'));
    return stripModuleExtension(path.posix.normalize(path.posix.join(sourceDir, moduleSpecifier)));
}

function modulePathMatches(normalized: string, modulePaths: Set<string>): boolean {
    if (modulePaths.has(normalized)) return true;
    for (const modulePath of modulePaths) {
        if (normalized.endsWith(`/${modulePath}`)) return true;
    }
    return false;
}

function isExpensiveReadModuleSpecifier(moduleSpecifier: string, relative: string): boolean {
    if (EXPENSIVE_READ_IMPORT_MODULES.has(moduleSpecifier)) return true;
    return modulePathMatches(normalizeModuleSpecifier(moduleSpecifier, relative), EXPENSIVE_READ_MODULE_PATHS);
}

function isDbModuleSpecifier(moduleSpecifier: string, relative: string): boolean {
    if (moduleSpecifier === '@/db') return true;
    return modulePathMatches(normalizeModuleSpecifier(moduleSpecifier, relative), new Set(['src/db']));
}

function collectImportedExpensiveReadFunctions(sourceFile: ts.SourceFile, relative: string): ImportedExpensiveReadFunctions {
    const identifiers = new Set<string>();
    const namespaces = new Set<string>();
    const propertyRoots = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !statement.importClause
            || statement.importClause.isTypeOnly
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !isExpensiveReadModuleSpecifier(statement.moduleSpecifier.text, relative)
        ) {
            continue;
        }

        const moduleSpecifier = statement.moduleSpecifier.text;
        const isDbModule = isDbModuleSpecifier(moduleSpecifier, relative);

        if (statement.importClause.name) {
            if (isDbModule) {
                propertyRoots.add(statement.importClause.name.text);
            } else {
                identifiers.add(statement.importClause.name.text);
            }
        }

        const bindings = statement.importClause.namedBindings;
        if (!bindings) continue;
        if (ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            continue;
        }
        if (!ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const importedName = element.propertyName?.text ?? element.name.text;
            if (isDbModule && importedName === 'db') {
                propertyRoots.add(element.name.text);
            } else {
                identifiers.add(element.name.text);
            }
        }
    }
    return { identifiers, namespaces, propertyRoots };
}

function isRateLimitHelperCall(node: ts.CallExpression, approvedRateLimitImports: Set<string>): boolean {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return false;
    return approvedRateLimitImports.has(callee.text);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
        current = ts.isParenthesizedExpression(current) ? current.expression : current.expression;
    }
    return current;
}

function isTrueLiteral(expression: ts.Expression): boolean {
    return unwrapExpression(expression).kind === ts.SyntaxKind.TrueKeyword;
}

function isFalseLiteral(expression: ts.Expression): boolean {
    return unwrapExpression(expression).kind === ts.SyntaxKind.FalseKeyword;
}

function isRateLimitResultIdentifier(expression: ts.Expression, rateLimitResultNames: Set<string>): boolean {
    const unwrapped = unwrapExpression(expression);
    return ts.isIdentifier(unwrapped) && rateLimitResultNames.has(unwrapped.text);
}

function isRateLimitCallExpression(expression: ts.Expression, approvedRateLimitImports: Set<string>): boolean {
    const unwrapped = unwrapExpression(expression);
    return ts.isCallExpression(unwrapped) && isRateLimitHelperCall(unwrapped, approvedRateLimitImports);
}

function expressionCapturesRateLimitResult(expression: ts.Expression, approvedRateLimitImports: Set<string>): boolean {
    return isRateLimitCallExpression(expression, approvedRateLimitImports);
}

function expressionChecksPositiveRateLimitResult(expression: ts.Expression, rateLimitResultNames: Set<string>): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
        return false;
    }
    if (isRateLimitResultIdentifier(unwrapped, rateLimitResultNames)) {
        return true;
    }
    if (!ts.isBinaryExpression(unwrapped)) {
        return false;
    }

    const leftIsResult = isRateLimitResultIdentifier(unwrapped.left, rateLimitResultNames);
    const rightIsResult = isRateLimitResultIdentifier(unwrapped.right, rateLimitResultNames);
    if (!leftIsResult && !rightIsResult) return false;
    const compared = leftIsResult ? unwrapped.right : unwrapped.left;

    switch (unwrapped.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken:
            return isTrueLiteral(compared);
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken:
            return isFalseLiteral(compared);
        default:
            return false;
    }
}

function expressionIsPositiveRateLimitGate(
    expression: ts.Expression,
    approvedRateLimitImports: Set<string>,
    rateLimitResultNames: Set<string>,
): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
        return false;
    }
    if (isRateLimitCallExpression(unwrapped, approvedRateLimitImports)) {
        return true;
    }
    return expressionChecksPositiveRateLimitResult(unwrapped, rateLimitResultNames);
}

function conditionReturnsEarly(statement: ts.Statement): boolean {
    if (ts.isReturnStatement(statement)) return true;
    if (ts.isBlock(statement)) return statement.statements.some(ts.isReturnStatement);
    return false;
}

function statementHasRateLimitGate(
    statement: ts.Statement,
    approvedRateLimitImports: Set<string>,
    rateLimitResultNames: Set<string>,
): boolean {
    if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
            if (
                ts.isIdentifier(decl.name)
                && decl.initializer
                && expressionCapturesRateLimitResult(decl.initializer, approvedRateLimitImports)
            ) {
                rateLimitResultNames.add(decl.name.text);
            }
        }
        return false;
    }
    if (!ts.isIfStatement(statement)) {
        return false;
    }
    return (
        expressionIsPositiveRateLimitGate(statement.expression, approvedRateLimitImports, rateLimitResultNames)
        && conditionReturnsEarly(statement.thenStatement)
    );
}

function isKnownMutationCall(node: ts.CallExpression, importedSideEffectFunctionNames: Set<string> = new Set()): boolean {
    const callee = node.expression;
    return (ts.isPropertyAccessExpression(callee) && MUTATING_CALL_METHOD_NAMES.has(callee.name.text))
        || (ts.isIdentifier(callee) && importedSideEffectFunctionNames.has(callee.text));
}

function bodyCallsRateLimitBeforeMutation(
    body: ts.Node | undefined,
    approvedRateLimitImports: Set<string>,
    sourceFile: ts.SourceFile,
    localMutatingFunctions: Set<string> = new Set(),
    importedSideEffectFunctionNames: Set<string> = new Set(),
    localExpensiveGetFunctions: Set<string> = new Set(),
    importedExpensiveReadFunctions: ImportedExpensiveReadFunctions = emptyImportedExpensiveReadFunctions(),
    shadowsApprovedRateLimit: boolean = false,
): boolean {
    if (!body || shadowsApprovedRateLimit) return false;

    let sawRateLimitGate = false;
    let sawProtectedWork = false;
    const rateLimitResultNames = new Set<string>();

    const inspectExpression = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            if (
                isKnownMutationCall(node, importedSideEffectFunctionNames)
                || (ts.isIdentifier(node.expression) && localMutatingFunctions.has(node.expression.text))
            ) {
                sawProtectedWork = true;
            }
        }
        ts.forEachChild(node, inspectExpression);
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
        const statementHasExpensiveWork = bodyContainsExpensiveGetWork(
            statement,
            sourceFile,
            localExpensiveGetFunctions,
            importedExpensiveReadFunctions,
        );
        if ((statementHasMutation || statementHasExpensiveWork) && !sawRateLimitGate) {
            sawProtectedWork = true;
        }
        if (statementHasRateLimitGate(statement, approvedRateLimitImports, rateLimitResultNames)) {
            sawRateLimitGate = true;
        }
    };

    if (ts.isBlock(body)) {
        for (const statement of body.statements) {
            inspectStatement(statement);
        }
    } else {
        inspectExpression(body);
        if (bodyContainsExpensiveGetWork(body, sourceFile, localExpensiveGetFunctions, importedExpensiveReadFunctions)) {
            sawProtectedWork = true;
        }
    }

    return sawRateLimitGate && !sawProtectedWork;
}

function bodyCallsRateLimitBeforeExpensiveGetWork(
    body: ts.Node | undefined,
    approvedRateLimitImports: Set<string>,
    sourceFile: ts.SourceFile,
    localExpensiveGetFunctions: Set<string>,
    importedExpensiveReadFunctions: ImportedExpensiveReadFunctions,
    shadowsApprovedRateLimit: boolean = false,
): boolean {
    if (!body || shadowsApprovedRateLimit) return false;

    let sawRateLimitGate = false;
    const rateLimitResultNames = new Set<string>();

    const nodeContainsExpensiveWork = (node: ts.Node | undefined): boolean => {
        return bodyContainsExpensiveGetWork(node, sourceFile, localExpensiveGetFunctions, importedExpensiveReadFunctions);
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
            if (statementHasRateLimitGate(statement, approvedRateLimitImports, rateLimitResultNames)) {
                sawRateLimitGate = true;
            }
        }
        return sawRateLimitGate;
    };

    if (ts.isBlock(body)) {
        return inspectStatements(body.statements);
    }

    return false;
}

function bodyContainsExpensiveGetWork(
    body: ts.Node | undefined,
    sourceFile: ts.SourceFile,
    localExpensiveGetFunctions: Set<string> = new Set(),
    importedExpensiveReadFunctions: ImportedExpensiveReadFunctions = emptyImportedExpensiveReadFunctions(),
): boolean {
    if (!body) return false;
    const identifierMarkers = new Set(EXPENSIVE_GET_MARKERS.filter((marker) => !marker.endsWith('.')));
    const propertyRootMarkers = new Set(
        EXPENSIVE_GET_MARKERS
            .filter((marker) => marker.endsWith('.'))
            .map((marker) => marker.slice(0, -1)),
    );

    const calleeMatchesMarker = (callee: ts.Expression): boolean => {
        if (ts.isIdentifier(callee)) {
            return identifierMarkers.has(callee.text);
        }
        if (ts.isPropertyAccessExpression(callee)) {
            const rootName = rootIdentifierName(callee);
            return (
                identifierMarkers.has(callee.name.text)
                || (rootName !== null && propertyRootMarkers.has(rootName))
            );
        }
        return false;
    };

    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== body) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (calleeMatchesMarker(callee)) {
                found = true;
                return;
            }
            if (
                ts.isIdentifier(callee)
                && (
                    localExpensiveGetFunctions.has(callee.text)
                    || importedExpensiveReadFunctions.identifiers.has(callee.text)
                )
            ) {
                found = true;
                return;
            }
            if (
                ts.isPropertyAccessExpression(callee)
                && rootIdentifierName(callee)
                && (
                    importedExpensiveReadFunctions.namespaces.has(rootIdentifierName(callee) as string)
                    || importedExpensiveReadFunctions.propertyRoots.has(rootIdentifierName(callee) as string)
                )
            ) {
                found = true;
                return;
            }
        }
        if (ts.isNewExpression(node) && calleeMatchesMarker(node.expression)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
}

function rootIdentifierName(expression: ts.Expression): string | null {
    let current = expression;
    while (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
    }
    return ts.isIdentifier(current) ? current.text : null;
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
    const importedExpensiveReadFunctions = collectImportedExpensiveReadFunctions(sourceFile, relative);

    // Find any exported mutating handler in the file
    const localBodies = new Map<string, FunctionBodyInfo>();
    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            localBodies.set(statement.name.text, { body: statement.body, parameters: [...statement.parameters] });
            continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !isFunctionLikeInitializer(decl.initializer)) continue;
            const info = functionInfoFromInitializer(decl.initializer);
            if (info) {
                localBodies.set(decl.name.text, info);
            }
        }
    }
    const localMutatingFunctions = new Set<string>();
    let mutatingSetChanged = true;
    while (mutatingSetChanged) {
        mutatingSetChanged = false;
        for (const [name, info] of localBodies) {
            if (!info.body || localMutatingFunctions.has(name)) continue;
            let containsMutation = false;
            const visit = (node: ts.Node) => {
                if (containsMutation) return;
                if (ts.isFunctionLike(node) && node !== info.body) return;
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
            visit(info.body);
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
        for (const [name, info] of localBodies) {
            if (!info.body || localExpensiveGetFunctions.has(name)) continue;
            if (bodyContainsExpensiveGetWork(info.body, sourceFile, localExpensiveGetFunctions, importedExpensiveReadFunctions)) {
                localExpensiveGetFunctions.add(name);
                expensiveGetSetChanged = true;
            }
        }
    }

    const mutatingHandlers: HandlerBody[] = [];
    const readHandlers: HandlerBody[] = [];
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
            const info: FunctionBodyInfo = { body: statement.body, parameters: [...statement.parameters] };
            const shadowsApprovedRateLimit = functionInfoShadowsName(info, approvedRateLimitImports);
            if (MUTATING_METHODS.has(statement.name.text)) {
                mutatingHandlers.push({ method: statement.name.text, body: statement.body, shadowsApprovedRateLimit });
            } else if (EXPENSIVE_READ_METHODS.has(statement.name.text)) {
                readHandlers.push({ method: statement.name.text, body: statement.body, shadowsApprovedRateLimit });
            }
        }
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && MUTATING_METHODS.has(decl.name.text)) {
                    const handler = handlerBodyFromExportedVariable(decl.initializer, localBodies, approvedRateLimitImports);
                    if (handler?.unsupportedAlias) {
                        report.failed.push(
                            `UNSUPPORTED HANDLER ALIAS: ${relative} exports ${decl.name.text} = ${handler.unsupportedAlias}, but this scanner could not resolve that local body. Export a local handler body or add a reasoned '${EXEMPT_TAG}: <reason>' comment.`,
                        );
                        continue;
                    }
                    if (handler) {
                        mutatingHandlers.push({
                            method: decl.name.text,
                            body: handler.body,
                            shadowsApprovedRateLimit: handler.shadowsApprovedRateLimit,
                        });
                    }
                } else if (
                    ts.isIdentifier(decl.name)
                    && EXPENSIVE_READ_METHODS.has(decl.name.text)
                ) {
                    const handler = handlerBodyFromExportedVariable(decl.initializer, localBodies, approvedRateLimitImports);
                    if (handler?.unsupportedAlias) {
                        report.failed.push(
                            `UNSUPPORTED HANDLER ALIAS: ${relative} exports ${decl.name.text} = ${handler.unsupportedAlias}, but this scanner could not resolve that local body. Export a local handler body or add a reasoned '${EXEMPT_TAG}: <reason>' comment.`,
                        );
                        continue;
                    }
                    if (handler) {
                        readHandlers.push({
                            method: decl.name.text,
                            body: handler.body,
                            shadowsApprovedRateLimit: handler.shadowsApprovedRateLimit,
                        });
                    }
                }
            }
        }
        // C1-BUG-02: handle export-specifier form: export { handler as POST }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (ts.isIdentifier(element.name) && MUTATING_METHODS.has(element.name.text)) {
                    const localName = element.propertyName?.text ?? element.name.text;
                    const localInfo = localBodies.get(localName);
                    mutatingHandlers.push({
                        method: element.name.text,
                        body: localInfo?.body,
                        shadowsApprovedRateLimit: functionInfoShadowsName(localInfo, approvedRateLimitImports),
                    });
                } else if (ts.isIdentifier(element.name) && EXPENSIVE_READ_METHODS.has(element.name.text)) {
                    if (statement.moduleSpecifier) {
                        const reExportLabel = element.name.text === 'GET'
                            ? 'UNSUPPORTED GET RE-EXPORT'
                            : 'UNSUPPORTED HEAD RE-EXPORT';
                        report.failed.push(
                            `${reExportLabel}: ${relative} re-exports ${element.name.text} from another module, which hides expensive work from this scanner. Export a local handler body or add a reasoned '${EXEMPT_TAG}: <reason>' comment.`,
                        );
                        continue;
                    }
                    const localName = element.propertyName?.text ?? element.name.text;
                    const localInfo = localBodies.get(localName);
                    readHandlers.push({
                        method: element.name.text,
                        body: localInfo?.body,
                        shadowsApprovedRateLimit: functionInfoShadowsName(localInfo, approvedRateLimitImports),
                    });
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
        const expensiveReadHandlers = readHandlers.filter((handler) => bodyContainsExpensiveGetWork(handler.body, sourceFile, localExpensiveGetFunctions, importedExpensiveReadFunctions));
        const protectedHandlers = [...mutatingHandlers, ...expensiveReadHandlers];
        const protectedReadMethods = new Set(expensiveReadHandlers.map((handler) => handler.method));
        const isSingleGetHeadPair = (
            mutatingHandlers.length === 0
            && protectedHandlers.length === protectedReadMethods.size
            && protectedReadMethods.size === 2
            && protectedReadMethods.has('GET')
            && protectedReadMethods.has('HEAD')
        );
        if (protectedHandlers.length > 1 && !isSingleGetHeadPair) {
            report.failed.push(
                `AMBIGUOUS RATE-LIMIT EXEMPTION: ${relative} exports protected handlers ${protectedHandlers.map((handler) => handler.method).join(', ')} and carries a file-level '${EXEMPT_TAG}: <reason>'. Move the exemption into a single-handler route file or rate-limit every non-exempt protected handler.`,
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
        sourceFile,
        localMutatingFunctions,
        importedSideEffectFunctionNames,
        localExpensiveGetFunctions,
        importedExpensiveReadFunctions,
        handler.shadowsApprovedRateLimit,
    ))) {
        report.passed.push(`OK: ${relative} (uses rate-limit helper)`);
    } else if (mutatingHandlers.length > 0) {
        report.failed.push(
            `MISSING RATE LIMIT: ${relative} exports mutating handler(s) ${mutatingHandlers.map((handler) => handler.method).join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit pre-increment helper before mutation (preIncrement* / checkAndIncrement*).`
        );
    }

    const expensiveReadHandlers = readHandlers.filter((handler) => bodyContainsExpensiveGetWork(handler.body, sourceFile, localExpensiveGetFunctions, importedExpensiveReadFunctions));
    if (expensiveReadHandlers.length > 0 && !hasExemption) {
        const unmeteredReadHandlers = expensiveReadHandlers.filter((handler) => !bodyCallsRateLimitBeforeExpensiveGetWork(
            handler.body,
            approvedRateLimitImports,
            sourceFile,
            localExpensiveGetFunctions,
            importedExpensiveReadFunctions,
            handler.shadowsApprovedRateLimit,
        ));
        if (unmeteredReadHandlers.length > 0) {
            report.failed.push(
                `MISSING RATE LIMIT: ${relative} exports expensive GET/HEAD handler(s) ${unmeteredReadHandlers.map((handler) => handler.method).join(', ')} but neither carries '${EXEMPT_TAG}: <reason>' nor calls a rate-limit pre-increment helper before expensive work.`
            );
        } else {
            report.passed.push(`OK: ${relative} (expensive GET uses rate-limit helper for GET/HEAD handlers)`);
        }
    }

    if (mutatingHandlers.length === 0 && expensiveReadHandlers.length === 0 && !hasExemption) {
        report.passed.push(`OK: ${relative} (no mutating or expensive GET handlers; HEAD is treated as an expensive read)`);
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
