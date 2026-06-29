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
 * - Auto-discovered RECURSIVELY via app/actions/ (all server-action-capable script descendants),
 *   EXCLUDING files whose basename is `auth`. `auth.ts` owns its own
 *   `hasTrustedSameOrigin` invocations directly at the call sites that
 *   the scanner cannot generically detect. Public actions are scanned with a
 *   narrower public-rate-limit contract for intentionally unauthenticated
 *   analytics writes.
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

const EXCLUDED_ACTION_BASENAMES = new Set(['auth']);

/**
 * Recursively walk a directory collecting action source files, excluding
 * basenames in `EXCLUDED_ACTION_BASENAMES`. Throws if the root cannot be
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
            if (EXCLUDED_ACTION_BASENAMES.has(parsed.name)) continue;
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

function hasExemptComment(node: ts.Node, source: string): boolean {
    const start = node.getFullStart();
    const end = node.getStart();
    const leadingText = source.slice(start, end);
    return /@action-origin-exempt/.test(leadingText);
}

function isRequireSameOriginAdminExpression(node: ts.Node): boolean {
    const expression = ts.isAwaitExpression(node) ? node.expression : node;
    return (
        ts.isCallExpression(expression)
        && ts.isIdentifier(expression.expression)
        && expression.expression.text === 'requireSameOriginAdmin'
    );
}

function sameOriginGuardVariableName(statement: ts.Statement): string | null {
    if (!ts.isVariableStatement(statement)) {
        return null;
    }

    for (const declaration of statement.declarationList.declarations) {
        if (
            ts.isIdentifier(declaration.name)
            && declaration.initializer
            && isRequireSameOriginAdminExpression(declaration.initializer)
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

function conditionChecksGuardVariable(expression: ts.Expression, guardName: string): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
        return unwrapped.text === guardName;
    }

    if (ts.isBinaryExpression(unwrapped)) {
        const left = unwrapExpression(unwrapped.left);
        const right = unwrapExpression(unwrapped.right);
        return (ts.isIdentifier(left) && left.text === guardName)
            || (ts.isIdentifier(right) && right.text === guardName);
    }

    return false;
}

function statementReturnsOnGuard(statement: ts.Statement, guardName: string): boolean {
    if (!ts.isIfStatement(statement) || !conditionChecksGuardVariable(statement.expression, guardName)) {
        return false;
    }

    if (ts.isReturnStatement(statement.thenStatement)) {
        return true;
    }

    if (ts.isBlock(statement.thenStatement)) {
        return statement.thenStatement.statements.some(ts.isReturnStatement);
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

/**
 * R4C2 SEC-R4C2-02: generic walker — true when any node in the subtree is a
 * DIRECT mutating call (`.insert(...)` / `.update(...)` / `logAuditEvent(...)`
 * / `revalidate*(...)` etc.). Used both for the pre-guard-mutation ordering
 * check and to reject `@action-origin-exempt` comments on mutating bodies.
 */
function nodeContainsMutatingCall(root: ts.Node): boolean {
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
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function statementContainsPreGuardMutation(statement: ts.Statement): boolean {
    return nodeContainsMutatingCall(statement);
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

function publicActionCallsRateLimitBeforeMutation(body: ts.Node): boolean {
    if (!ts.isBlock(body)) return false;
    let sawRateLimit = false;
    const publicRateLimitNames = new Set(['isViewRecordRateLimited', 'preIncrementLoadMoreAttempt']);

    for (const statement of body.statements) {
        if (statementContainsPreGuardMutation(statement) && !sawRateLimit) {
            return false;
        }
        if (nodeContainsCallNamed(statement, publicRateLimitNames)) {
            sawRateLimit = true;
        }
    }

    return sawRateLimit;
}

function functionCallsRequireSameOriginAdmin(body: ts.Node): boolean {
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
        const guardName = sameOriginGuardVariableName(body.statements[index]);
        if (!guardName) continue;

        if (body.statements.slice(0, index).some(statementContainsPreGuardMutation)) {
            return false;
        }

        for (const followingStatement of body.statements.slice(index + 1)) {
            if (statementReturnsOnGuard(followingStatement, guardName)) {
                return true;
            }
            if (statementContainsPreGuardMutation(followingStatement)) {
                return false;
            }
        }

        return false;
    }

    return false;
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
    const sourceFile = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const lineOf = (node: ts.Node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const evaluateBody = (owner: ts.Node, body: ts.Node | undefined, name: string) => {
        if (hasExemptComment(owner, content)) {
            // R4C2 SEC-R4C2-02: exemption is reserved for READ-ONLY exports
            // (scanner header + CLAUDE.md "Lint Gates"). Honoring the comment
            // unconditionally let a mutating action opt out of verification
            // entirely — the guard could later be refactored away with the
            // gate still green. An exempt comment on a body containing a
            // direct mutating call is therefore a hard failure, not a skip.
            if (body && nodeContainsMutatingCall(body)) {
                if (relative.endsWith('actions/public.ts') && publicActionCallsRateLimitBeforeMutation(body)) {
                    report.passed.push(`OK (public rate-limited action): ${relative}::${name}`);
                    return;
                }
                report.failed.push(
                    `EXEMPT COMMENT ON MUTATING ACTION: ${relative}:${lineOf(owner)} ${name} carries '@action-origin-exempt' but its body performs mutations; exemption is reserved for read-only exports — remove the comment and return early on requireSameOriginAdmin() instead`,
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

        if (!functionCallsRequireSameOriginAdmin(body)) {
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
            // Arrow function: `async (...) => ...`
            if (ts.isArrowFunction(init)) {
                const funcModifiers = ts.getModifiers(init);
                const isAsync = !!funcModifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
                if (!isAsync) continue;
                const name = declaration.name.text;
                // `init.body` is a concise-body expression OR a block; both are
                // ts.Node and walkable by functionCallsRequireSameOriginAdmin.
                // R4C2 SEC-R4C2-02: pass the STATEMENT as the comment owner —
                // a leading `@action-origin-exempt` JSDoc attaches to the
                // `export const …` statement's trivia, not to the inner
                // VariableDeclaration node, so exemption detection (and the
                // new exempt-on-mutating-body rejection) must look there.
                evaluateBody(statement, init.body, name);
                continue;
            }
            // Function expression: `async function (...) {...}`
            if (ts.isFunctionExpression(init)) {
                const funcModifiers = ts.getModifiers(init);
                const isAsync = !!funcModifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
                if (!isAsync) continue;
                const name = declaration.name.text;
                evaluateBody(statement, init.body, name);
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
