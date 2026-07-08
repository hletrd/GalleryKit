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
 * - `apps/web/src/app/actions.ts` (top-level compatibility barrel), which
 *   must stay a pure action-module re-export surface.
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
const APPROVED_ADMIN_MUTATION_BARRIER_MODULE = '@/lib/admin-mutation-barrier';
const APPROVED_PRE_ORIGIN_AUTH_READ_MODULES = new Set([
    '@/app/actions',
    '@/app/actions/auth',
]);
const DB_MODULE = '@/db';

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
    // Also include the top-level action barrel so it cannot grow direct
    // action exports outside the recursive app/actions/ scan.
    found.push(path.join(REPO_SRC, 'app/actions.ts'));
    return found.sort();
}

function parseSourceFile(file: string): ts.SourceFile {
    const content = fs.readFileSync(file, 'utf-8');
    let scriptKind = ts.ScriptKind.TS;
    if (file.endsWith('.tsx')) {
        scriptKind = ts.ScriptKind.TSX;
    } else if (file.endsWith('.jsx')) {
        scriptKind = ts.ScriptKind.JSX;
    } else if (/\.[cm]?js$/.test(file)) {
        scriptKind = ts.ScriptKind.JS;
    }
    return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function sourceFileHasTopLevelUseServerDirective(sourceFile: ts.SourceFile): boolean {
    for (const statement of sourceFile.statements) {
        if (
            ts.isExpressionStatement(statement)
            && ts.isStringLiteral(statement.expression)
        ) {
            if (statement.expression.text === 'use server') return true;
            continue;
        }
        return false;
    }

    return false;
}

function blockHasUseServerDirective(body: ts.Block): boolean {
    for (const statement of body.statements) {
        if (
            ts.isExpressionStatement(statement)
            && ts.isStringLiteral(statement.expression)
        ) {
            if (statement.expression.text === 'use server') return true;
            continue;
        }
        return false;
    }
    return false;
}

function getFunctionBody(node: ts.Node): ts.Block | undefined {
    if (
        (
            ts.isFunctionDeclaration(node)
            || ts.isFunctionExpression(node)
            || ts.isArrowFunction(node)
            || ts.isMethodDeclaration(node)
            || ts.isGetAccessorDeclaration(node)
            || ts.isSetAccessorDeclaration(node)
            || ts.isConstructorDeclaration(node)
        )
        && node.body
        && ts.isBlock(node.body)
    ) {
        return node.body;
    }
    return undefined;
}

function sourceFileHasInlineUseServerDirective(sourceFile: ts.SourceFile): boolean {
    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        const body = getFunctionBody(node);
        if (body && blockHasUseServerDirective(body)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return found;
}

function discoverAppSourceFiles(root: string): string[] {
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

export type UseServerDiscovery = {
    file: string;
    kind: 'inline' | 'top-level';
};

export function findUnscannedUseServerFiles(appRoot: string, actionFiles: string[]): UseServerDiscovery[] {
    const approved = new Set(actionFiles.map((file) => path.resolve(file)));
    return discoverAppSourceFiles(appRoot)
        .flatMap((file): UseServerDiscovery[] => {
            const sourceFile = parseSourceFile(file);
            const discoveries: UseServerDiscovery[] = [];
            if (sourceFileHasTopLevelUseServerDirective(sourceFile) && !approved.has(path.resolve(file))) {
                discoveries.push({ file, kind: 'top-level' });
            }
            if (sourceFileHasInlineUseServerDirective(sourceFile)) {
                discoveries.push({ file, kind: 'inline' });
            }
            return discoveries;
        })
        .sort((a, b) => `${a.file}:${a.kind}`.localeCompare(`${b.file}:${b.kind}`));
}

function checkForUnscannedUseServerFiles(actionFiles: string[]): void {
    const appDir = path.join(REPO_SRC, 'app');
    const unscanned = findUnscannedUseServerFiles(appDir, actionFiles);

    for (const discovery of unscanned) {
        const relative = path.relative(process.cwd(), discovery.file);
        if (discovery.kind === 'top-level') {
            console.error(
                `UNSCANNED SERVER ACTION MODULE: ${relative} has a top-level 'use server' directive but is outside the approved lint:action-origin scan set. ` +
                `Move it under src/app/actions/, add an explicit scanner entry with review, or keep the module free of server-action exports.`,
            );
        } else {
            console.error(
                `INLINE SERVER ACTION: ${relative} has a function-level 'use server' directive, which bypasses the export-based lint:action-origin scanner. ` +
                `Move the action into src/app/actions/ with a direct exported async function/const so same-origin and mutation-barrier checks can be verified.`,
            );
        }
        failed = true;
    }
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

// ARCH9-03 / AGG9B-12 (loop-B cycle 9b): the restore-window mutation fence
// (`using ... = acquireAdminMutationSlot()`, C1-03/C77-ARCH-01) is a
// documented universal requirement on every mutating admin action, but only
// manual review enforced it — a new mutating export could omit the slot and
// reopen the drain-race window with no CI signal. The same-origin scanner
// already classifies every export, so it now also requires the barrier
// acquisition (or a reasoned `@mutation-barrier-exempt: <reason>` comment,
// reserved for exports fenced by an equivalent mechanism — e.g. the restore
// flow, which IS the exclusive side of this barrier and is serialized by the
// `gallerykit_db_restore` advisory lock instead).
function hasMutationBarrierExemptTag(node: ts.Node, source: string): boolean {
    return /@mutation-barrier-exempt/.test(getLeadingText(node, source));
}

function hasReasonedMutationBarrierExemptComment(node: ts.Node, source: string): boolean {
    return /@mutation-barrier-exempt:[^\S\r\n]*(?=[^\s*/])/.test(getLeadingText(node, source));
}

function requiresAdminMutationBarrier(relative: string): boolean {
    const normalized = relative.replaceAll(path.sep, '/');
    return normalized.startsWith('src/app/actions/')
        || normalized === 'src/app/[locale]/admin/db-actions.ts';
}

function collectApprovedAdminMutationSlotImports(sourceFile: ts.SourceFile): Set<string> {
    const approved = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== APPROVED_ADMIN_MUTATION_BARRIER_MODULE
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'acquireAdminMutationSlot') {
                approved.add(element.name.text);
            }
        }
    }
    return approved;
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

function collectPreOriginAuthReadNames(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set(PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES);
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        const approvedModule = APPROVED_PRE_ORIGIN_AUTH_READ_MODULES.has(statement.moduleSpecifier.text);
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES.has(importedName)) {
                if (approvedModule) {
                    names.add(element.name.text);
                } else {
                    names.delete(element.name.text);
                }
            }
        }
    }
    return names;
}

function collectApprovedReadAuthNames(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
            || !APPROVED_PRE_ORIGIN_AUTH_READ_MODULES.has(statement.moduleSpecifier.text)
        ) {
            continue;
        }
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES.has(importedName)) {
                names.add(element.name.text);
            }
        }
    }
    return names;
}

type DbReadBindings = {
    directNames: Set<string>;
    namespaceNames: Set<string>;
};

type FunctionBodyInfo = {
    body: ts.Node;
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

function bodyDeclaresBindingName(body: ts.Node, candidates: Set<string>): boolean {
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

function functionInfoDeclaresBindingName(info: FunctionBodyInfo | undefined, candidates: Set<string>): boolean {
    if (!info || candidates.size === 0) return false;
    return parametersIntersect(info.parameters, candidates) || bodyDeclaresBindingName(info.body, candidates);
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

function isDbModuleSpecifier(moduleSpecifier: string, relative: string): boolean {
    if (moduleSpecifier === DB_MODULE) return true;
    const normalized = normalizeModuleSpecifier(moduleSpecifier, relative);
    return normalized === 'src/db' || normalized.endsWith('/src/db');
}

function collectDbReadBindings(sourceFile: ts.SourceFile, relative: string): DbReadBindings {
    const directNames = new Set(['db']);
    const namespaceNames = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !statement.importClause?.namedBindings
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !isDbModuleSpecifier(statement.moduleSpecifier.text, relative)
        ) {
            continue;
        }
        if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
            namespaceNames.add(statement.importClause.namedBindings.name.text);
            continue;
        }
        if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'db') {
                directNames.add(element.name.text);
            }
        }
    }
    return { directNames, namespaceNames };
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
    while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
        current = ts.isParenthesizedExpression(current) ? current.expression : current.expression;
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
    preOriginAuthReadNames: Set<string>,
): boolean {
    if (!ts.isIfStatement(statement) || !conditionChecksGuardVariable(statement.expression, guardName)) {
        return false;
    }

    return branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames, preOriginAuthReadNames);
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
    preOriginAuthReadNames: Set<string> = PRE_ORIGIN_AUTH_READ_FUNCTION_NAMES,
): boolean {
    const statements = ts.isBlock(branch) ? branch.statements : [branch];
    for (const statement of statements) {
        if (
            statementContainsPreGuardMutation(statement, localMutatingFunctions, importedSideEffectFunctionNames)
            || statementContainsPreOriginAuthRead(statement, preOriginAuthReadNames)
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

const APPROVED_PUBLIC_RATE_LIMIT_MODULE = '@/lib/rate-limit';

const PUBLIC_RATE_LIMIT_HELPER_NAMES = new Set([
    'checkLoadMoreRateLimit',
    'preIncrementLoadMoreAttempt',
    'rollbackLoadMoreAttempt',
    'rollbackSearchAttempt',
    'isViewRecordRateLimited',
    'checkViewRecordRateLimit',
]);

function collectUnapprovedPublicRateLimitImports(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            continue;
        }
        const approvedModule = statement.moduleSpecifier.text === APPROVED_PUBLIC_RATE_LIMIT_MODULE;
        for (const element of statement.importClause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (PUBLIC_RATE_LIMIT_HELPER_NAMES.has(importedName) && !approvedModule) {
                names.add(element.name.text);
            }
        }
    }
    return names;
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

function expressionReadsMutationSlotAcquired(expression: ts.Expression, slotName: string): boolean {
    const unwrapped = unwrapExpression(expression);
    return (
        ts.isPropertyAccessExpression(unwrapped)
        && unwrapped.name.text === 'acquired'
        && ts.isIdentifier(unwrapped.expression)
        && unwrapped.expression.text === slotName
    );
}

function statementReturnsEarly(statement: ts.Statement): boolean {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (ts.isBlock(statement)) {
        return statement.statements.some(statementReturnsEarly);
    }
    return false;
}

function statementIsMutationSlotEarlyReturnGate(statement: ts.Statement, slotName: string): boolean {
    if (!ts.isIfStatement(statement)) return false;
    const condition = unwrapExpression(statement.expression);
    if (
        ts.isPrefixUnaryExpression(condition)
        && condition.operator === ts.SyntaxKind.ExclamationToken
        && expressionReadsMutationSlotAcquired(condition.operand, slotName)
    ) {
        return statementReturnsEarly(statement.thenStatement);
    }
    return false;
}

function statementIsMutationSlotPositiveGuard(statement: ts.Statement, slotName: string): statement is ts.IfStatement {
    if (!ts.isIfStatement(statement)) return false;
    const condition = unwrapExpression(statement.expression);
    return expressionReadsMutationSlotAcquired(condition, slotName);
}

function statementChecksMutationSlotAcquired(
    statement: ts.Statement,
    slotName: string,
    followingStatements: readonly ts.Statement[],
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    if (statementIsMutationSlotEarlyReturnGate(statement, slotName)) {
        return true;
    }

    if (!statementIsMutationSlotPositiveGuard(statement, slotName)) {
        return false;
    }

    if (statement.elseStatement && nodeContainsMutatingCall(
        statement.elseStatement,
        localMutatingFunctions,
        importedSideEffectFunctionNames,
    )) {
        return false;
    }

    return !followingStatements.some((followingStatement) => nodeContainsMutatingCall(
        followingStatement,
        localMutatingFunctions,
        importedSideEffectFunctionNames,
    ));
}

function isApprovedMutationSlotCall(expression: ts.Expression | undefined, approvedImports: Set<string>): boolean {
    if (!expression) return false;
    const unwrapped = unwrapExpression(expression);
    return (
        ts.isCallExpression(unwrapped)
        && ts.isIdentifier(unwrapped.expression)
        && approvedImports.has(unwrapped.expression.text)
    );
}

function bodyAcquiresAdminMutationSlot(
    body: ts.Node,
    approvedImports: Set<string>,
    shadowsApprovedImport: boolean,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
): boolean {
    if (shadowsApprovedImport || approvedImports.size === 0 || !ts.isBlock(body)) {
        return false;
    }

    const blockHasApprovedSlot = (block: ts.Block): boolean => {
        for (let i = 0; i < block.statements.length; i++) {
            const statement = block.statements[i];
            if (!ts.isVariableStatement(statement)) continue;
            const isUsing = (statement.declarationList.flags & ts.NodeFlags.Using) !== 0;
            if (!isUsing) continue;

            for (const declaration of statement.declarationList.declarations) {
                if (
                    !ts.isIdentifier(declaration.name)
                    || !isApprovedMutationSlotCall(declaration.initializer, approvedImports)
                ) {
                    continue;
                }
                const slotName = declaration.name.text;
                const nextStatement = block.statements[i + 1];
                if (nextStatement && statementChecksMutationSlotAcquired(
                    nextStatement,
                    slotName,
                    block.statements.slice(i + 2),
                    localMutatingFunctions,
                    importedSideEffectFunctionNames,
                )) {
                    return true;
                }
            }
        }
        return false;
    };

    return blockHasApprovedSlot(body);
}

function statementContainsPreOriginAuthRead(statement: ts.Statement, preOriginAuthReadNames: Set<string>): boolean {
    return nodeContainsCallNamed(statement, preOriginAuthReadNames);
}

function nodeContainsProtectedRead(root: ts.Node, dbReadBindings: DbReadBindings): boolean {
    const DRIZZLE_RELATIONAL_READ_METHODS = new Set(['findFirst', 'findMany']);
    const isDbReadRoot = (node: ts.Expression): boolean => {
        if (ts.isIdentifier(node)) {
            return dbReadBindings.directNames.has(node.text);
        }
        if (
            ts.isPropertyAccessExpression(node)
            && node.name.text === 'db'
            && ts.isIdentifier(node.expression)
        ) {
            return dbReadBindings.namespaceNames.has(node.expression.text);
        }
        return false;
    };
    const isDrizzleRelationalReadCall = (node: ts.CallExpression): boolean => {
        const callee = node.expression;
        if (!ts.isPropertyAccessExpression(callee) || !DRIZZLE_RELATIONAL_READ_METHODS.has(callee.name.text)) {
            return false;
        }
        const tableAccess = callee.expression;
        if (!ts.isPropertyAccessExpression(tableAccess)) return false;
        const queryAccess = tableAccess.expression;
        return (
            ts.isPropertyAccessExpression(queryAccess)
            && queryAccess.name.text === 'query'
            && isDbReadRoot(queryAccess.expression)
        );
    };

    let found = false;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isFunctionLike(node) && node !== root) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (
                (ts.isPropertyAccessExpression(callee) && callee.name.text === 'select')
                || isDrizzleRelationalReadCall(node)
            ) {
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

const unwrapReadAuthExpression = unwrapExpression;

function isPreOriginAuthReadExpression(expression: ts.Expression, preOriginAuthReadNames: Set<string>): boolean {
    const unwrapped = unwrapReadAuthExpression(expression);
    return ts.isCallExpression(unwrapped)
        && ts.isIdentifier(unwrapped.expression)
        && preOriginAuthReadNames.has(unwrapped.expression.text);
}

function readAuthInitializerKind(
    expression: ts.Expression,
    approvedImports: Set<string>,
    preOriginAuthReadNames: Set<string>,
): 'error' | 'auth' | null {
    if (isRequireSameOriginAdminExpression(expression, approvedImports)) {
        return 'error';
    }
    if (isPreOriginAuthReadExpression(expression, preOriginAuthReadNames)) {
        return 'auth';
    }
    return null;
}

function conditionChecksReadAuthEarlyExit(
    expression: ts.Expression,
    originErrorNames: Set<string>,
    authResultNames: Set<string>,
    approvedImports: Set<string>,
    preOriginAuthReadNames: Set<string>,
): boolean {
    const unwrapped = unwrapReadAuthExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
        return originErrorNames.has(unwrapped.text);
    }

    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
        const operand = unwrapReadAuthExpression(unwrapped.operand);
        if (ts.isIdentifier(operand)) {
            return authResultNames.has(operand.text);
        }
        return isPreOriginAuthReadExpression(operand, preOriginAuthReadNames);
    }

    if (ts.isBinaryExpression(unwrapped)) {
        const left = unwrapReadAuthExpression(unwrapped.left);
        const right = unwrapReadAuthExpression(unwrapped.right);
        const leftName = ts.isIdentifier(left) ? left.text : null;
        const rightName = ts.isIdentifier(right) ? right.text : null;
        const compared = leftName ? right : left;
        const name = leftName ?? rightName;
        if (!name) return false;

        if (originErrorNames.has(name)) {
            if (
                unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                || unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
            ) {
                return isNullLiteral(compared) || isUndefinedIdentifier(compared);
            }
            return false;
        }

        if (authResultNames.has(name)) {
            if (
                unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
                || unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
            ) {
                return isNullLiteral(compared) || isUndefinedIdentifier(compared);
            }
        }
    }

    return isRequireSameOriginAdminExpression(unwrapped, approvedImports);
}

function statementEstablishesReadAuth(
    statement: ts.Statement,
    originErrorNames: Set<string>,
    authResultNames: Set<string>,
    approvedImports: Set<string>,
    preOriginAuthReadNames: Set<string>,
): boolean {
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            const kind = readAuthInitializerKind(declaration.initializer, approvedImports, preOriginAuthReadNames);
            if (kind === 'error') {
                originErrorNames.add(declaration.name.text);
            } else if (kind === 'auth') {
                authResultNames.add(declaration.name.text);
            }
        }
        return false;
    }

    if (!ts.isIfStatement(statement)) {
        return false;
    }
    return conditionChecksReadAuthEarlyExit(statement.expression, originErrorNames, authResultNames, approvedImports, preOriginAuthReadNames)
        && branchExitsBeforeSideEffect(statement.thenStatement, new Set(), new Set(), preOriginAuthReadNames);
}

function exemptReadHasAuthBeforeProtectedRead(
    body: ts.Node,
    approvedImports: Set<string>,
    approvedReadAuthNames: Set<string>,
    dbReadBindings: DbReadBindings,
    actionShadowsReadAuth: boolean = false,
): boolean {
    if (!ts.isBlock(body)) {
        return !nodeContainsProtectedRead(body, dbReadBindings);
    }
    if (actionShadowsReadAuth) {
        return false;
    }

    let sawAuth = false;
    const originErrorNames = new Set<string>();
    const authResultNames = new Set<string>();
    for (const statement of body.statements) {
        if (!sawAuth && nodeContainsProtectedRead(statement, dbReadBindings)) {
            return false;
        }
        if (statementEstablishesReadAuth(statement, originErrorNames, authResultNames, approvedImports, approvedReadAuthNames)) {
            sawAuth = true;
        }
    }
    return true;
}

function publicActionCallsRateLimitBeforeMutation(
    body: ts.Node,
    localMutatingFunctions: Set<string>,
    importedSideEffectFunctionNames: Set<string>,
    actionShadowsRateLimit: boolean = false,
): boolean {
    if (!ts.isBlock(body)) return false;
    let sawRateLimitGate = false;
    let sawMutationBeforeRateLimit = false;
    const booleanRateLimitNames = new Set(['isViewRecordRateLimited', 'preIncrementLoadMoreAttempt']);
    const statusRateLimitNames = new Set(['checkViewRecordRateLimit', 'checkLoadMoreRateLimit']);
    const publicRateLimitNames = new Set([...booleanRateLimitNames, ...statusRateLimitNames]);
    const booleanRateLimitResultNames = new Set<string>();
    const statusRateLimitResultNames = new Set<string>();
    const restoreOnlyRateLimitState = () => {
        booleanRateLimitResultNames.clear();
        statusRateLimitResultNames.clear();
        sawRateLimitGate = false;
    };

    const actionBodyShadowsRateLimit = (): boolean => {
        let shadows = false;
        const checkBindingName = (name: ts.BindingName) => {
            if (ts.isIdentifier(name) && publicRateLimitNames.has(name.text)) {
                shadows = true;
            }
        };
        const visit = (current: ts.Node) => {
            if (shadows) return;
            if (ts.isFunctionDeclaration(current) && current.name && publicRateLimitNames.has(current.name.text)) {
                shadows = true;
                return;
            }
            if (ts.isVariableDeclaration(current)) {
                checkBindingName(current.name);
            }
            if (
                current !== body
                && ts.isFunctionLike(current)
            ) {
                for (const parameter of current.parameters) {
                    checkBindingName(parameter.name);
                }
                return;
            }
            ts.forEachChild(current, visit);
        };
        for (const statement of body.statements) visit(statement);
        return shadows;
    };

    if (actionShadowsRateLimit || actionBodyShadowsRateLimit()) return false;

    const unwrapPublicExpression = (expression: ts.Expression): ts.Expression => {
        let current = expression;
        while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
            current = ts.isParenthesizedExpression(current) ? current.expression : current.expression;
        }
        return current;
    };

    const rateLimitCallKind = (expression: ts.Expression): 'boolean' | 'status' | null => {
        const unwrapped = unwrapPublicExpression(expression);
        if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) return null;
        if (booleanRateLimitNames.has(unwrapped.expression.text)) return 'boolean';
        if (statusRateLimitNames.has(unwrapped.expression.text)) return 'status';
        return null;
    };

    const isTrueLiteral = (expression: ts.Expression): boolean => {
        return unwrapPublicExpression(expression).kind === ts.SyntaxKind.TrueKeyword;
    };

    const isFalseLiteral = (expression: ts.Expression): boolean => {
        return unwrapPublicExpression(expression).kind === ts.SyntaxKind.FalseKeyword;
    };

    const isRateLimitedLiteral = (expression: ts.Expression): boolean => {
        const unwrapped = unwrapPublicExpression(expression);
        return ts.isStringLiteral(unwrapped) && unwrapped.text === 'rateLimited';
    };

    const isBooleanRateLimitResult = (expression: ts.Expression): boolean => {
        const unwrapped = unwrapPublicExpression(expression);
        return ts.isIdentifier(unwrapped) && booleanRateLimitResultNames.has(unwrapped.text);
    };

    const isStatusRateLimitProperty = (expression: ts.Expression): boolean => {
        const unwrapped = unwrapPublicExpression(expression);
        if (!ts.isPropertyAccessExpression(unwrapped) || unwrapped.name.text !== 'status') {
            return false;
        }
        const receiver = unwrapPublicExpression(unwrapped.expression);
        if (rateLimitCallKind(receiver) === 'status') {
            return true;
        }
        return ts.isIdentifier(receiver) && statusRateLimitResultNames.has(receiver.text);
    };

    const expressionIsPositiveRateLimitGate = (expression: ts.Expression): boolean => {
        const unwrapped = unwrapPublicExpression(expression);
        if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
            return false;
        }
        if (rateLimitCallKind(unwrapped) === 'boolean') {
            return true;
        }
        if (isBooleanRateLimitResult(unwrapped)) {
            return true;
        }
        if (!ts.isBinaryExpression(unwrapped)) {
            return false;
        }

        const leftIsBoolean = isBooleanRateLimitResult(unwrapped.left);
        const rightIsBoolean = isBooleanRateLimitResult(unwrapped.right);
        if (leftIsBoolean || rightIsBoolean) {
            const compared = leftIsBoolean ? unwrapped.right : unwrapped.left;
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

        const leftIsStatus = isStatusRateLimitProperty(unwrapped.left);
        const rightIsStatus = isStatusRateLimitProperty(unwrapped.right);
        if (!leftIsStatus && !rightIsStatus) return false;
        const compared = leftIsStatus ? unwrapped.right : unwrapped.left;
        switch (unwrapped.operatorToken.kind) {
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken:
                return isRateLimitedLiteral(compared);
            default:
                return false;
        }
    };

    const statementHasRateLimitGate = (statement: ts.Statement): boolean => {
        if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.initializer) {
                    const kind = rateLimitCallKind(decl.initializer);
                    if (kind === 'boolean') {
                        booleanRateLimitResultNames.add(decl.name.text);
                    } else if (kind === 'status') {
                        statusRateLimitResultNames.add(decl.name.text);
                    }
                }
            }
            return false;
        }
        if (ts.isIfStatement(statement)) {
            return (
                expressionIsPositiveRateLimitGate(statement.expression)
                && branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames)
            );
        }
        return false;
    };

    const trackedAnalyticsCallbackBody = (statement: ts.Statement): ts.Block | null => {
        let callbackBody: ts.Block | null = null;
        const visit = (node: ts.Node) => {
            if (callbackBody) return;
            if (
                ts.isCallExpression(node)
                && ts.isIdentifier(node.expression)
                && node.expression.text === 'trackAnalyticsDbWrite'
            ) {
                const callback = node.arguments[0];
                if (
                    callback
                    && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
                    && ts.isBlock(callback.body)
                ) {
                    callbackBody = callback.body;
                    return;
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(statement);
        return callbackBody;
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

        const analyticsCallback = trackedAnalyticsCallbackBody(statement);
        if (analyticsCallback) {
            if (sawRateLimitGate) {
                return;
            }
            restoreOnlyRateLimitState();
            for (const nested of analyticsCallback.statements) processStatement(nested);
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
    preOriginAuthReadNames: Set<string>,
    actionShadowsApprovedGuard: boolean = false,
): boolean {
    // Only accept an effective guard in the exported action's own top-level
    // body. The guard function returns a localized error string; merely
    // calling it is not sufficient because callers must return early on that
    // value before mutating state. Recursive AST search let dead branches,
    // uncalled nested helpers, and ignored guard results satisfy the gate even
    // though the real action path had no provenance enforcement.
    if (!ts.isBlock(body) || actionShadowsApprovedGuard) {
        return false;
    }

    for (let index = 0; index < body.statements.length; index++) {
        const guardName = sameOriginGuardVariableName(body.statements[index], approvedImports);
        if (!guardName) continue;

        const preGuardStatements = body.statements.slice(0, index);
        if (
            preGuardStatements.some((statement) => statementContainsPreGuardMutation(statement, localMutatingFunctions, importedSideEffectFunctionNames))
            || preGuardStatements.some((statement) => statementContainsPreOriginAuthRead(statement, preOriginAuthReadNames))
        ) {
            return false;
        }

        for (const followingStatement of body.statements.slice(index + 1)) {
            if (statementReturnsOnGuard(followingStatement, guardName, localMutatingFunctions, importedSideEffectFunctionNames, preOriginAuthReadNames)) {
                return true;
            }
            if (
                statementContainsPreGuardMutation(followingStatement, localMutatingFunctions, importedSideEffectFunctionNames)
                || statementContainsPreOriginAuthRead(followingStatement, preOriginAuthReadNames)
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
    preOriginAuthReadNames: Set<string>,
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
            || preGuardStatements.some((preGuardStatement) => statementContainsPreOriginAuthRead(preGuardStatement, preOriginAuthReadNames))
        ) {
            return false;
        }

        return branchExitsBeforeSideEffect(statement.thenStatement, localMutatingFunctions, importedSideEffectFunctionNames, preOriginAuthReadNames);
    }

    return false;
}

function hasAsyncModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

function isAllowedActionBarrelModuleSpecifier(moduleSpecifier: ts.Expression | undefined): boolean {
    return (
        !!moduleSpecifier
        && ts.isStringLiteral(moduleSpecifier)
        && moduleSpecifier.text.startsWith('./actions/')
    );
}

function functionInfoFromExpression(
    expression: ts.Expression | undefined,
    options: { requireAsync?: boolean } = {},
): FunctionBodyInfo | undefined {
    if (!expression) return undefined;
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        if (options.requireAsync && !hasAsyncModifier(expression)) return undefined;
        return { body: expression.body, parameters: [...expression.parameters] };
    }
    if (ts.isCallExpression(expression)) {
        const functionArgs = expression.arguments.filter((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
        if (functionArgs.length !== 1) return undefined;
        const [arg] = functionArgs;
        if (options.requireAsync && !hasAsyncModifier(arg)) return undefined;
        return { body: arg.body, parameters: [...arg.parameters] };
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
    const approvedAdminMutationSlotImports = collectApprovedAdminMutationSlotImports(sourceFile);
    const preOriginAuthReadNames = collectPreOriginAuthReadNames(sourceFile);
    const approvedReadAuthNames = collectApprovedReadAuthNames(sourceFile);
    const unapprovedPublicRateLimitImports = collectUnapprovedPublicRateLimitImports(sourceFile);
    const dbReadBindings = collectDbReadBindings(sourceFile, relative);
    const importedSideEffectFunctionNames = collectImportedSideEffectFunctionNames(sourceFile);
    const isAuthActionsFile = /(?:^|[/\\])actions[/\\]auth\.[cm]?[jt]sx?$/.test(relative);
    const isActionBarrelFile = /(?:^|[/\\])app[/\\]actions\.[cm]?[jt]sx?$/.test(relative);
    const localBodies = new Map<string, FunctionBodyInfo>();
    const localMutatingFunctions = new Set<string>();

    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
            localBodies.set(statement.name.text, { body: statement.body, parameters: [...statement.parameters] });
            continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
            const info = functionInfoFromExpression(decl.initializer);
            if (info) {
                localBodies.set(decl.name.text, info);
            }
        }
    }

    let mutatingSetChanged = true;
    while (mutatingSetChanged) {
        mutatingSetChanged = false;
        for (const [name, info] of localBodies) {
            if (PUBLIC_RATE_LIMIT_HELPER_NAMES.has(name) || localMutatingFunctions.has(name)) continue;
            if (nodeContainsMutatingCall(info.body, localMutatingFunctions, importedSideEffectFunctionNames)) {
                localMutatingFunctions.add(name);
                mutatingSetChanged = true;
            }
        }
    }

    const lineOf = (node: ts.Node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    if (isActionBarrelFile) {
        for (const statement of sourceFile.statements) {
            if (ts.isImportDeclaration(statement)) continue;
            if (ts.isExportDeclaration(statement)) {
                if (statement.isTypeOnly) continue;
                if (isAllowedActionBarrelModuleSpecifier(statement.moduleSpecifier)) continue;
                report.failed.push(
                    `UNSUPPORTED ACTION BARREL EXPORT: ${relative}:${lineOf(statement)} app/actions.ts may only re-export values from './actions/*' modules or type-only exports`,
                );
                continue;
            }
            const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
            const isExported = !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
            if (isExported || ts.isExportAssignment(statement)) {
                report.failed.push(
                    `UNSUPPORTED ACTION BARREL EXPORT: ${relative}:${lineOf(statement)} app/actions.ts must stay a pure action-module re-export barrel; put direct action bodies under app/actions/`,
                );
            }
        }
        if (report.failed.length === 0) {
            report.passed.push(`OK (action barrel): ${relative}`);
        }
        return report;
    }

    const evaluateBody = (owner: ts.Node, bodyInfo: FunctionBodyInfo | undefined, name: string) => {
        const body = bodyInfo?.body;
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
                if (
                    relative.endsWith('actions/public.ts')
                    && publicActionCallsRateLimitBeforeMutation(
                        body,
                        localMutatingFunctions,
                        importedSideEffectFunctionNames,
                        functionInfoDeclaresBindingName(bodyInfo, PUBLIC_RATE_LIMIT_HELPER_NAMES)
                            || unapprovedPublicRateLimitImports.size > 0,
                    )
                ) {
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
                && !exemptReadHasAuthBeforeProtectedRead(
                    body,
                    approvedRequireSameOriginImports,
                    approvedReadAuthNames,
                    dbReadBindings,
                    functionInfoDeclaresBindingName(bodyInfo, approvedReadAuthNames),
                )
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
            preOriginAuthReadNames,
            functionInfoDeclaresBindingName(bodyInfo, approvedRequireSameOriginImports),
        );
        const hasAuthGuard = isAuthActionsFile
            && functionCallsAuthSameOriginGuard(
                body,
                approvedHasTrustedSameOriginImports,
                localMutatingFunctions,
                importedSideEffectFunctionNames,
                preOriginAuthReadNames,
            );
        if (!hasStandardGuard && !hasAuthGuard) {
            report.failed.push(
                `MISSING requireSameOriginAdmin: ${relative}:${lineOf(owner)} ${name} must return early on requireSameOriginAdmin() or carry '@action-origin-exempt: <reason>' comment`,
            );
            return;
        }

        // ARCH9-03 / AGG9B-12: every export that needs the origin guard is a
        // mutating admin action, and every mutating admin action must also
        // hold the restore-fence barrier slot for its body (CLAUDE.md "Race
        // Condition Protections", C1-03/C77-ARCH-01) — or carry a reasoned
        // exemption naming the equivalent fence it relies on instead.
        if (!requiresAdminMutationBarrier(relative)) {
            report.passed.push(`OK: ${relative}::${name}`);
            return;
        }
        if (hasMutationBarrierExemptTag(owner, content) && !hasReasonedMutationBarrierExemptComment(owner, content)) {
            report.failed.push(
                `MALFORMED MUTATION-BARRIER EXEMPTION: ${relative}:${lineOf(owner)} ${name} carries '@mutation-barrier-exempt' without a non-empty ': <reason>'; name the equivalent restore fence the export relies on`,
            );
            return;
        }
        if (!bodyAcquiresAdminMutationSlot(
            body,
            approvedAdminMutationSlotImports,
            functionInfoDeclaresBindingName(bodyInfo, approvedAdminMutationSlotImports),
            localMutatingFunctions,
            importedSideEffectFunctionNames,
        )) {
            if (hasReasonedMutationBarrierExemptComment(owner, content)) {
                report.passed.push(`OK (barrier-exempt with reason): ${relative}::${name}`);
                return;
            }
            report.failed.push(
                `MISSING acquireAdminMutationSlot: ${relative}:${lineOf(owner)} ${name} must hold the admin-mutation barrier slot for its body (using ... = acquireAdminMutationSlot() from ${APPROVED_ADMIN_MUTATION_BARRIER_MODULE}, followed by an acquired-state gate) or carry '@mutation-barrier-exempt: <reason>' naming its equivalent restore fence`,
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
            if (!statement.body) {
                report.failed.push(
                    `UNSUPPORTED action declaration without body: ${relative}:${lineOf(statement)} ${statement.name.text} must expose a local body so requireSameOriginAdmin() can be verified`,
                );
                continue;
            }
            evaluateBody(statement, { body: statement.body, parameters: [...statement.parameters] }, statement.name.text);
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
            const exportedInfo = functionInfoFromExpression(init, { requireAsync: true });
            if (exportedInfo) {
                // `export const …` comments attach to the VariableStatement,
                // not the inner VariableDeclaration or wrapped function arg.
                evaluateBody(statement, exportedInfo, name);
                continue;
            }
            if (ts.isIdentifier(init)) {
                const aliasedInfo = localBodies.get(init.text);
                if (aliasedInfo) {
                    evaluateBody(statement, aliasedInfo, name);
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
    checkForUnscannedUseServerFiles(actionFiles);
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
