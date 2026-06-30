/* SECURITY-CRITICAL: this lint gate enforces defense-in-depth
 * same-origin checks on every mutating server action. Silencing,
 * downgrading, or weakening this scanner (or its exemption logic)
 * removes a layer of CSRF/origin-confusion protection. DO NOT modify
 * without a security review. See CLAUDE.md "Lint Gates" section.
 */
/**
 * CI check (C2R-02): verifies every mutating server action in the
 * scanned files calls `requireSameOriginAdmin()` (defense-in-depth
 * Origin/Referer check) or carries an explicit opt-out comment
 * `// @action-origin-exempt: <reason>`.
 *
 * Scanned files (C5R-RPL-06 / AGG5R-05 + C6R-RPL-02 / AGG6R-01):
 * - Auto-discovered RECURSIVELY via app/actions/ (all server-action-capable script descendants).
 *   `auth.ts` is scanned with an auth-specific approved `hasTrustedSameOrigin`
 *   guard shape because it owns login/logout/password-change flows directly.
 *   Public actions are scanned with a narrower public-rate-limit contract for
 *   intentionally unauthenticated analytics writes.
 * - `apps/web/src/app/[locale]/admin/db-actions.ts` (hard-coded because
 *   it lives outside the `actions/` directory).
 *
 * Glob-based recursive discovery means new action files added to
 * `actions/` (including nested subdirectories like
 * `actions/admin/foo.ts`) are automatically covered — no manual
 * allow-list edit required.
 *
 * Exemptions:
 * - Read-only exports must opt out with a leading JSDoc comment.
 *   Getter-style names are not automatically trusted because names are not
 *   proof that an exported server action is read-only.
 * - Each export can opt out with a leading JSDoc comment:
 *     /** @action-origin-exempt: <reason> **\/
 *
 * Run with: npx tsx scripts/check-action-origin.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_SRC = path.resolve(__dirname, '../src');

/**
 * Files in `app/actions/` that intentionally bypass the generic scanner.
 * Maintained here (not in the scanned set) to avoid false positives.
 */
const ACTION_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

const APPROVED_ACTION_GUARD_MODULE = '@/lib/action-guards';
const APPROVED_AUTH_GUARD_MODULE = '@/lib/request-origin';

/**
 * Recursively walk a directory collecting action source files. Throws if the root cannot be
 * read — failing loudly is correct because a missing root indicates a
 * repository layout change that breaks the security lint gate.
 */
export function walkForActionFiles(root: string): string[] {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
        const dir = stack.pop() as string;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (!entry.isFile()) continue;
            const parsed = path.parse(entry.name);
            if (!ACTION_FILE_EXTENSIONS.has(parsed.ext)) continue;
            out.push(full);
        }
    }
    return out;
}

/**
 * Discover every mutating-action file the scanner should check. Uses
 * RECURSIVE discovery over app/actions/ (all action-capable extensions) so
 * new files added anywhere beneath `actions/` — including nested
 * subdirectories — are covered automatically. Prior behavior was a
 * single-level readdir which would silently miss files in
 * subdirectories (C6R-RPL-02 / AGG6R-01).
 */
function discoverActionFiles(): string[] {
    const actionsDir = path.join(REPO_SRC, 'app/actions');
    let found: string[];
    try {
        found = walkForActionFiles(actionsDir);
    } catch (err) {
        const resolved = path.resolve(actionsDir);
        const expected = path.join(REPO_SRC, 'app', 'actions');
        console.error(
            `Failed to discover action files under ${actionsDir}.\n` +
            `Resolved absolute path: ${resolved}\n` +
            `Expected path: ${expected}\n` +
            `Hint: run this script from the apps/web/ directory (npx tsx scripts/check-action-origin.ts)`,
            err,
        );
        throw err;
    }
    // Also include the admin db-actions file which lives outside app/actions/.
    found.push(path.join(REPO_SRC, 'app/[locale]/admin/db-actions.ts'));
    return found.sort();
}

function getLeadingText(node: ts.Node, source: string): string {
    const start = node.getFullStart();
    const end = node.getStart();
    return source.slice(start, end);
}

function hasExemptTag(node: ts.Node, source: string): boolean {
    return /@action-origin-exempt/.test(getLeadingText(node, source));
}

function hasReasonedExemptComment(node: ts.Node, source: string): boolean {
    return /@action-origin-exempt:[^\S\r\n]*(?=[^\s*/])/.test(getLeadingText(node, source));
}

function collectApprovedRequireSameOriginImports(sourceFile: ts.SourceFile): Set<string> {
    const approved = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== APPROVED_ACTION_GUARD_MODULE
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'requireSameOriginAdmin') {
                approved.add(element.name.text);
            }
        }
    }
    return approved;
}

function collectApprovedHasTrustedSameOriginImports(sourceFile: ts.SourceFile): Set<string> {
    const approved = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== APPROVED_AUTH_GUARD_MODULE
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'hasTrustedSameOrigin') {
                approved.add(element.name.text);
            }
        }
    }
    return approved;
}

function isRequireSameOriginAdminExpression(node: ts.Node, approvedImports: Set<string>): boolean {
    const expression = ts.isAwaitExpression(node) ? node.expression : node;
    return (
        ts.isCallExpression(expression)
        && ts.isIdentifier(expression.expression)
        && approvedImports.has(expression.expression.text)
    );
}

function sameOriginGuardVariableName(statement: ts.Statement, approvedImports: Set<string>): string | null {
    if (!ts.isVariableStatement(statement)) {
        return null;
    }

    for (const declaration of statement.declarationList.declarations) {
        if (
            ts.isIdentifier(declaration.name)
            && declaration.initializer
            && isRequireSameOriginAdminExpression(declaration.initializer, approvedImports)
        ) {
            return declaration.name.text;
        }
    }

    return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

function isNullLiteral(node: ts.Expression): boolean {
    return node.kind === ts.SyntaxKind.NullKeyword;
}

function isUndefinedIdentifier(node: ts.Expression): boolean {
    return ts.isIdentifier(node) && node.text === 'undefined';
}

function conditionChecksGuardVariable(expression: ts.Expression, guardName: string): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
        return unwrapped.text === guardName;
    }

    if (ts.isBinaryExpression(unwrapped)) {
        const left = unwrapExpression(unwrapped.left);
        const right = unwrapExpression(unwrapped.right);
        const leftIsGuard = ts.isIdentifier(left) && left.text === guardName;
        const rightIsGuard = ts.isIdentifier(right) && right.text === guardName;
        if (!leftIsGuard && !rightIsGuard) return false;

        const compared = leftIsGuard ? right : left;
        if (unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
            return isNullLiteral(compared);
        }
        if (unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
            return isNullLiteral(compared) || isUndefinedIdentifier(compared);
        }
        return false;
    }

    return false;
}

function statementReturnsOnGuard(
    statement: ts.Statement,
    guardName: string,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    if (!ts.isIfStatement(statement) || !conditionChecksGuardVariable(statement.expression, guardName)) {
        return false;
    }

    return branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames);
}

function statementExitsEarly(statement: ts.Statement): boolean {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
        const callee = statement.expression.expression;
        return ts.isIdentifier(callee) && callee.text === 'redirect';
    }
    if (ts.isBlock(statement)) {
        return statement.statements.some(statementExitsEarly);
    }
    return false;
}

function branchExitsBeforeSideEffect(
    branch: ts.Statement,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    const statements = ts.isBlock(branch) ? branch.statements : [branch];
    for (const statement of statements) {
        if (
            statementContainsPreGuardMutation(statement, localMutatingFunctions, importedSideEffectFunctionNames)
            || statementContainsPreOriginAuthRead(statement)
        ) {
            return false;
        }
        if (statementExitsEarly(statement)) {
            return true;
        }
    }
    return false;
}

const MUTATING_METHOD_NAMES = new Set([
    'insert',
    'update',
    'delete',
    'transaction',
    'query',
    'execute',
    'beginTransaction',
    'commit',
    'rollback',
]);

const MUTATING_FUNCTION_NAMES = new Set([
    'logAuditEvent',
    'revalidateLocalizedPaths',
    'revalidateAllAppData',
    // R15C15 TE-15-03: the project wraps cache invalidation in the helpers
    // above, but a future action calling the raw Next.js primitives directly
    // (before requireSameOriginAdmin()) would otherwise slip past the scanner.
    'revalidatePath',
    'revalidateTag',
]);

const IMPORTED_SIDE_EFFECT_NAME_RE = /^(?:create|delete|remove|insert|update|upsert|write|enqueue|settle|cleanup|log|revalidate|track|mark|begin|end|resume|quiesce|drain|flush|acquire|release|revoke|issue|mint|rotate|restore|dump)(?:[A-Z_]|$)/i;

const PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES = new Set([
    'getCurrentUser',
    'getSession',
    'isAdmin',
]);

const PUBLIC_RATE_LIMIT_HELPER_NAMES = new Set([
    'checkLoadMoreRateLimit',
    'preIncrementLoadMoreAttempt',
    'rollbackLoadMoreAttempt',
    'rollbackSearchAttempt',
    'isViewRecordRateLimited',
    'checkViewRecordRateLimit',
]);

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

/**
 * R4C2 SEC-R4C2-02: generic walker — true when any node in the subtree is a
 * DIRECT mutating call (`.insert(...)` / `.update(...)` / `logAuditEvent(...)`
 * / `revalidate*(...)` etc.). Used both for the pre-guard-mutation ordering
 * check and to reject `@action-origin-exempt` comments on mutating bodies.
 */
function nodeContainsMutatingCall(
    root: ts.Node,
    localMutatingFunctions: Set<string> = new Set(),
    importedSideEffectFunctionNames: Set<string> = new Set(),
): boolean {
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && MUTATING_METHOD_NAMES.has(callee.name.text)) {
                found = true;
                return;
            }
            if (ts.isIdentifier(callee) && MUTATING_FUNCTION_NAMES.has(callee.text)) {
                found = true;
                return;
            }
            if (ts.isIdentifier(callee) && localMutatingFunctions.has(callee.text)) {
                found = true;
                return;
            }
            if (ts.isIdentifier(callee) && importedSideEffectFunctionNames.has(callee.text)) {
                found = true;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function statementContainsPreGuardMutation(
    statement: ts.Statement,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    return nodeContainsMutatingCall(statement, localMutatingFunctions, importedSideEffectFunctionNames);
}

function nodeContainsCallNamed(root: ts.Node, names: Set<string>): boolean {
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function statementContainsPreOriginAuthRead(statement: ts.Statement): boolean {
    return nodeContainsCallNamed(statement, PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES);
}

function nodeContainsProtectedRead(root: ts.Node): boolean {
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== root) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'select') {
                found = true;
                return;
            }
            if (
                ts.isIdentifier(callee)
                && /^(?:getAdmin|list.*ForUser|readAdmin|queryAdmin|loadAdmin)/.test(callee.text)
            ) {
                found = true;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function statementContainsReadAuth(statement: ts.Statement, approvedImports: Set<string>): boolean {
    let found = false;
    const authNames = new Set(['isAdmin', 'getCurrentUser']);
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== statement) return;
        if (isRequireSameOriginAdminExpression(node, approvedImports)) {
            found = true;
            return;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && authNames.has(node.expression.text)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(statement);
    return found;
}

function exemptReadHasAuthBeforeProtectedRead(body: ts.Node, approvedImports: Set<string>): boolean {
    if (!ts.isBlock(body)) {
        return true;
    }

    let sawAuth = false;
    for (const statement of body.statements) {
        if (!sawAuth && nodeContainsProtectedRead(statement)) {
            return false;
        }
        if (statementContainsReadAuth(statement, approvedImports)) {
            sawAuth = true;
        }
    }
    return true;
}

function publicActionCallsRateLimitBeforeMutation(
    body: ts.Node,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    if (!ts.isBlock(body)) return false;
    let sawRateLimitGate = false;
    let sawMutationBeforeRateLimit = false;
    const publicRateLimitNames = new Set(['isViewRecordRateLimited', 'checkViewRecordRateLimit', 'preIncrementLoadMoreAttempt', 'checkLoadMoreRateLimit']);
    const rateLimitResultNames = new Set<string>();

    const expressionCallsRateLimit = (node: ts.Node): boolean => {
        let found = false;
        const visit = (current: ts.Node) => {
            if (found) return;
            if (ts.isFunctionLike(current)) return;
            if (
                ts.isCallExpression(current)
                && ts.isIdentifier(current.expression)
                && publicRateLimitNames.has(current.expression.text)
            ) {
                found = true;
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return found;
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
                    && expressionCallsRateLimit(decl.initializer)
                ) {
                    rateLimitResultNames.add(decl.name.text);
                }
            }
            return false;
        }
        if (ts.isIfStatement(statement)) {
            return (
                (expressionCallsRateLimit(statement.expression) || expressionChecksRateLimitResult(statement.expression))
                && branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames)
            );
        }
        return false;
    };

    const visitMutation = (node: ts.Node) => {
        if (sawMutationBeforeRateLimit) return;
        if (ts.isFunctionLike(node)) return;

        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && MUTATING_METHOD_NAMES.has(callee.name.text) && !sawRateLimitGate) {
                sawMutationBeforeRateLimit = true;
                return;
            }
            if (ts.isIdentifier(callee) && MUTATING_FUNCTION_NAMES.has(callee.text) && !sawRateLimitGate) {
                sawMutationBeforeRateLimit = true;
                return;
            }
            if (ts.isIdentifier(callee) && importedSideEffectFunctionNames.has(callee.text) && !sawRateLimitGate) {
                sawMutationBeforeRateLimit = true;
                return;
            }
            if (ts.isIdentifier(callee) && localMutatingFunctions.has(callee.text) && !sawRateLimitGate) {
                sawMutationBeforeRateLimit = true;
                return;
            }
        }

        ts.forEachChild(node, visitMutation);
    };

    const processStatement = (statement: ts.Statement) => {
        if (sawMutationBeforeRateLimit) return;

        if (ts.isBlock(statement)) {
            for (const nested of statement.statements) processStatement(nested);
            return;
        }

        if (ts.isTryStatement(statement)) {
            const sawRateLimitBeforeTry = sawRateLimitGate;
            if (statement.catchClause) {
                sawRateLimitGate = sawRateLimitBeforeTry;
                for (const nested of statement.catchClause.block.statements) processStatement(nested);
            }
            if (statement.finallyBlock) {
                sawRateLimitGate = sawRateLimitBeforeTry;
                for (const nested of statement.finallyBlock.statements) processStatement(nested);
            }
            sawRateLimitGate = sawRateLimitBeforeTry;
            for (const nested of statement.tryBlock.statements) processStatement(nested);
            return;
        }

        if (statementHasRateLimitGate(statement)) {
            sawRateLimitGate = true;
        }
        visitMutation(statement);
    };

    for (const statement of body.statements) {
        processStatement(statement);
    }

    return sawRateLimitGate && !sawMutationBeforeRateLimit;
}

function functionCallsRequireSameOriginAdmin(
    body: ts.Node,
    approvedImports: Set<string>,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    // Only accept an effective guard in the exported action's own top-level
    // body. The guard function returns a localized error string; merely
    // calling it is not sufficient because callers must return early on that
    // value before mutating state. Recursive AST search let dead branches,
    // uncalled nested helpers, and ignored guard results satisfy the gate even
    // though the real action path had no provenance enforcement.
    if (!ts.isBlock(body)) {
        return false;
    }

    for (let index = 0; index < body.statements.length; index++) {
        const guardName = sameOriginGuardVariableName(body.statements[index], approvedImports);
        if (!guardName) continue;

        const preGuardStatements = body.statements.slice(0, index);
        if (
            preGuardStatements.some((statement) => statementContainsPreGuardMutation(statement, localMutatingFunctions, importedSideEffectFunctionNames))
            || preGuardStatements.some(statementContainsPreOriginAuthRead)
        ) {
            return false;
        }

        for (const followingStatement of body.statements.slice(index + 1)) {
            if (statementReturnsOnGuard(followingStatement, guardName, localMutatingFunctions, importedSideEffectFunctionNames)) {
                return true;
            }
            if (
                statementContainsPreGuardMutation(followingStatement, localMutatingFunctions, importedSideEffectFunctionNames)
                || statementContainsPreOriginAuthRead(followingStatement)
            ) {
                return false;
            }
        }

        return false;
    }

    return false;
}

function functionCallsAuthSameOriginGuard(
    body: ts.Node,
    approvedHasTrustedSameOriginImports: Set<string>,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    if (!ts.isBlock(body)) {
        return false;
    }

    const expressionIsUntrustedOriginCheck = (expression: ts.Expression): boolean => {
        const unwrapped = unwrapExpression(expression);
        if (!ts.isPrefixUnaryExpression(unwrapped) || unwrapped.operator !== ts.SyntaxKind.ExclamationToken) {
            return false;
        }
        const target = unwrapExpression(unwrapped.operand);
        return (
            ts.isCallExpression(target)
            && ts.isIdentifier(target.expression)
            && approvedHasTrustedSameOriginImports.has(target.expression.text)
        );
    };

    for (let index = 0; index < body.statements.length; index++) {
        const statement = body.statements[index];
        if (!ts.isIfStatement(statement) || !expressionIsUntrustedOriginCheck(statement.expression)) {
            continue;
        }

        const preGuardStatements = body.statements.slice(0, index);
        if (
            preGuardStatements.some((preGuardStatement) => statementContainsPreGuardMutation(preGuardStatement, localMutatingFunctions, importedSideEffectFunctionNames))
            || preGuardStatements.some(statementContainsPreOriginAuthRead)
        ) {
            return false;
        }

        return branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames);
    }

    return false;
}

function hasAsyncModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

function functionBodyFromExpression(
    expression: ts.Expression | undefined,
    options: { requireAsync?: boolean } = {},
): ts.Node | undefined {
    if (!expression) return undefined;
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        if (options.requireAsync && !hasAsyncModifier(expression)) return undefined;
        return expression.body;
    }
    if (ts.isCallExpression(expression)) {
        const functionArgs = expression.arguments.filter((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
        if (functionArgs.length !== 1) return undefined;
        const [arg] = functionArgs;
        if (options.requireAsync && !hasAsyncModifier(arg)) return undefined;
        return arg.body;
    }
    return undefined;
}

type CheckReport = {
    passed: string[];
    failed: string[];
    skipped: string[];
};

/**
 * C5R-RPL-03 — core scanner logic exposed as a pure function for unit tests
 * (see `apps/web/src/__tests__/check-action-origin.test.ts`). Returns per-check
 * outcomes instead of mutating global state so tests can assert exact sets.
 *
 * Accepts:
 *   - `export async function doThing(...)` (existing behavior)
 *   - `export const doThing = async (...) => {...}` (arrow expression)
 *   - `export const doThing = async function (...) {...}` (function expression)
 *
 * Without the arrow/function-expression branch, a future refactor could
 * silently drop `requireSameOriginAdmin()` and the lint would still return
 * OK — the gate would lie. See aggregate finding AGG5R-01.
 */
export function checkActionSource(content: string, relative: string = 'input.ts'): CheckReport {
    const report: CheckReport = { passed: [], failed: [], skipped: [] };
    let scriptKind = ts.ScriptKind.TS;
    if (relative.endsWith('.tsx')) {
        scriptKind = ts.ScriptKind.TSX;
    } else if (relative.endsWith('.jsx')) {
        scriptKind = ts.ScriptKind.JSX;
    } else if (relative.endsWith('.js') || relative.endsWith('.mjs') || relative.endsWith('.cjs')) {
        scriptKind = ts.ScriptKind.JS;
    }
    const sourceFile = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, scriptKind);
    const approvedRequireSameOriginImports = collectApprovedRequireSameOriginImports(sourceFile);
    const approvedHasTrustedSameOriginImports = collectApprovedHasTrustedSameOriginImports(sourceFile);
    const importedSideEffectFunctionNames = collectImportedSideEffectFunctionNames(sourceFile);
    const isAuthActionsFile = /(?:^|[/\\])actions[/\\]auth\.[cm]?[jt]sx?$/.test(relative);
    const localBodies = new Map<string, ts.Node>();
    const localMutatingFunctions = new Set<string>();

    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
            localBodies.set(statement.name.text, statement.body);
            continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
            const body = functionBodyFromExpression(decl.initializer);
            if (body) {
                localBodies.set(decl.name.text, body);
            }
        }
    }

    let mutatingSetChanged = true;
    while (mutatingSetChanged) {
        mutatingSetChanged = false;
        for (const [name, body] of localBodies) {
            if (PUBLIC_RATE_LIMIT_HELPER_NAMES.has(name) || localMutatingFunctions.has(name)) continue;
            if (nodeContainsMutatingCall(body, localMutatingFunctions, importedSideEffectFunctionNames)) {
                localMutatingFunctions.add(name);
                mutatingSetChanged = true;
            }
        }
    }

    const lineOf = (node: ts.Node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const evaluateBody = (owner: ts.Node, body: ts.Node | undefined, name: string) => {
        if (hasExemptTag(owner, content) && !hasReasonedExemptComment(owner, content)) {
            report.failed.push(
                `MALFORMED ACTION-ORIGIN EXEMPTION: ${relative}:${lineOf(owner)} ${name} carries '@action-origin-exempt' without a non-empty ': <reason>'; document why the export is read-only or intentionally public`,
            );
            return;
        }

        if (hasReasonedExemptComment(owner, content)) {
            // R4C2 SEC-R4C2-02: exemption is reserved for READ-ONLY exports
            // (scanner header + CLAUDE.md "Lint Gates"). Honoring the comment
            // unconditionally let a mutating action opt out of verification
            // entirely — the guard could later be refactored away with the
            // gate still green. An exempt comment on a body containing a
            // direct mutating call is therefore a hard failure, not a skip.
            if (body && nodeContainsMutatingCall(body, localMutatingFunctions, importedSideEffectFunctionNames)) {
                if (relative.endsWith('actions/public.ts') && publicActionCallsRateLimitBeforeMutation(body, localMutatingFunctions, importedSideEffectFunctionNames)) {
                    report.passed.push(`OK (public rate-limited action): ${relative}::${name}`);
                    return;
                }
                report.failed.push(
                    `EXEMPT COMMENT ON MUTATING ACTION: ${relative}:${lineOf(owner)} ${name} carries '@action-origin-exempt' but its body performs mutations; exemption is reserved for read-only exports — remove the comment and return early on requireSameOriginAdmin() instead`,
                );
                return;
            }
            if (
                body
                && !isAuthActionsFile
                && !relative.endsWith('actions/public.ts')
                && !exemptReadHasAuthBeforeProtectedRead(body, approvedRequireSameOriginImports)
            ) {
                report.failed.push(
                    `EXEMPT READ WITHOUT AUTH: ${relative}:${lineOf(owner)} ${name} carries '@action-origin-exempt' and performs protected reads before isAdmin(), getCurrentUser(), or requireSameOriginAdmin()`,
                );
                return;
            }
            report.skipped.push(`SKIP (exempt comment): ${relative}::${name}`);
            return;
        }

        if (!body) {
            report.failed.push(`MISSING BODY: ${relative}::${name}`);
            return;
        }

        const hasStandardGuard = functionCallsRequireSameOriginAdmin(
            body,
            approvedRequireSameOriginImports,
            localMutatingFunctions,
            importedSideEffectFunctionNames,
        );
        const hasAuthGuard = isAuthActionsFile
            && functionCallsAuthSameOriginGuard(
                body,
                approvedHasTrustedSameOriginImports,
                localMutatingFunctions,
                importedSideEffectFunctionNames,
            );
        if (!hasStandardGuard && !hasAuthGuard) {
            report.failed.push(
                `MISSING requireSameOriginAdmin: ${relative}:${lineOf(owner)} ${name} must return early on requireSameOriginAdmin() or carry '@action-origin-exempt: <reason>' comment`,
            );
            return;
        }

        report.passed.push(`OK: ${relative}::${name}`);
    };

    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) {
            continue;
        }

        if (ts.isExportAssignment(statement)) {
            report.failed.push(
                `UNSUPPORTED default export: ${relative}:${lineOf(statement)} default exports hide action names from this scanner. Use a direct named async export so requireSameOriginAdmin() can be verified`,
            );
            continue;
        }

        if (ts.isExportDeclaration(statement) && !statement.exportClause && statement.moduleSpecifier) {
            report.failed.push(
                `STAR RE-EXPORT: ${relative}:${lineOf(statement)} uses 'export * from …', which hides action exports from this scanner. Re-export actions directly so requireSameOriginAdmin() can be verified`,
            );
            continue;
        }

        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                if (element.isTypeOnly) continue;
                const name = element.name.text;
                report.failed.push(
                    `UNSUPPORTED aliased export: ${relative}:${lineOf(statement)} ${name} must use a direct exported async function/const so requireSameOriginAdmin() can be verified`,
                );
            }
            continue;
        }

        // Form 1: `export async function foo() {...}`
        if (ts.isFunctionDeclaration(statement)) {
            const modifiers = ts.getModifiers(statement);
            const isExported = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
            const isAsync = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
            const isDefault = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
            if (isExported && isDefault) {
                report.failed.push(
                    `UNSUPPORTED default export: ${relative}:${lineOf(statement)} default exports hide action names from this scanner. Use a direct named async export so requireSameOriginAdmin() can be verified`,
                );
                continue;
            }
            if (!isExported || !isAsync || !statement.name) continue;
            evaluateBody(statement, statement.body, statement.name.text);
            continue;
        }

        // Form 2: `export const foo = async (...) => {...}` or
        //         `export const foo = async function (...) {...}`
        if (!ts.isVariableStatement(statement)) continue;
        const varModifiers = ts.getModifiers(statement);
        const isExported = !!varModifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            const init = declaration.initializer;
            if (!init) continue;
            const name = declaration.name.text;
            const exportedBody = functionBodyFromExpression(init, { requireAsync: true });
            if (exportedBody) {
                // `export const …` comments attach to the VariableStatement,
                // not the inner VariableDeclaration or wrapped function arg.
                evaluateBody(statement, exportedBody, name);
                continue;
            }
            if (ts.isIdentifier(init)) {
                const aliasedBody = localBodies.get(init.text);
                if (aliasedBody) {
                    evaluateBody(statement, aliasedBody, name);
                    continue;
                }
                report.failed.push(
                    `UNSUPPORTED exported identifier alias: ${relative}:${lineOf(statement)} ${name} aliases ${init.text}, but this scanner could not resolve that body. Use a direct exported async function/const so requireSameOriginAdmin() can be verified`,
                );
                continue;
            }
            if (ts.isCallExpression(init)) {
                report.failed.push(
                    `UNSUPPORTED exported call wrapper: ${relative}:${lineOf(statement)} ${name} must wrap exactly one async function body directly or use a direct exported async function/const so requireSameOriginAdmin() can be verified`,
                );
                continue;
            }
        }
    }

    return report;
}

let failed = false;

function checkActionFile(file: string) {
    if (!fs.existsSync(file)) {
        console.error(`MISSING FILE: ${file}`);
        failed = true;
        return;
    }
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    const report = checkActionSource(content, relative);

    for (const line of report.skipped) console.log(line);
    for (const line of report.passed) console.log(line);
    for (const line of report.failed) {
        console.error(line);
        failed = true;
    }
}

// CLI entrypoint — guarded so the unit test can import checkActionSource
// without triggering the whole-repo scan at module load time.
const isCliEntry = require.main === module || (typeof require === 'undefined' && import.meta?.url?.includes('check-action-origin'));
if (isCliEntry) {
    const actionFiles = discoverActionFiles();
    for (const file of actionFiles) {
        checkActionFile(file);
    }

    if (failed) {
        console.error('\nOne or more mutating server actions are missing the same-origin provenance check.');
        console.error('Fix by returning early on `requireSameOriginAdmin()` or documenting an explicit exemption.');
        process.exit(1);
    }

    console.log('\nAll mutating server actions enforce same-origin provenance.');
    process.exit(0);
}
