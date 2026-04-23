/**
 * CI check (C2R-02): verifies every mutating server action in
 * `apps/web/src/app/actions/*.ts` + `apps/web/src/app/[locale]/admin/db-actions.ts`
 * calls `requireSameOriginAdmin()` (defense-in-depth Origin/Referer check) or
 * carries an explicit opt-out comment `// @action-origin-exempt: <reason>`.
 *
 * Exemptions are intentionally rare. Read-only getters (functions whose name
 * starts with `get`, and `login`/`logout`/`updatePassword` which have their own
 * `hasTrustedSameOrigin` invocations upstream) are automatically exempt.
 *
 * Run with: npx tsx scripts/check-action-origin.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_SRC = path.resolve(__dirname, '../src');

const ACTION_FILES = [
    path.join(REPO_SRC, 'app/actions/admin-users.ts'),
    path.join(REPO_SRC, 'app/actions/images.ts'),
    path.join(REPO_SRC, 'app/actions/seo.ts'),
    path.join(REPO_SRC, 'app/actions/settings.ts'),
    path.join(REPO_SRC, 'app/actions/sharing.ts'),
    path.join(REPO_SRC, 'app/actions/tags.ts'),
    path.join(REPO_SRC, 'app/actions/topics.ts'),
    path.join(REPO_SRC, 'app/[locale]/admin/db-actions.ts'),
];

// Exemptions:
// - Read-only getters (name starts with `get`): exempt — they don't mutate.
// - `auth.ts` functions: exempt — they own their own `hasTrustedSameOrigin`
//   call via `login`/`updatePassword`. `logout` does not need the helper
//   because it only invalidates the current session (idempotent).
// - `public.ts`: exempt — these are unauthenticated server actions that
//   explicitly do not enforce same-origin (they have their own rate-limit
//   pathway via search + loadMoreImages).
//
// Each function can additionally opt-out with a leading JSDoc comment:
//   /** @action-origin-exempt: <reason> */
const AUTOMATIC_NAME_EXEMPTIONS = /^get[A-Z]/;

function shouldCheckFunction(name: string): boolean {
    return !AUTOMATIC_NAME_EXEMPTIONS.test(name);
}

function hasExemptComment(node: ts.Node, source: string): boolean {
    const start = node.getFullStart();
    const end = node.getStart();
    const leadingText = source.slice(start, end);
    return /@action-origin-exempt/.test(leadingText);
}

function functionCallsRequireSameOriginAdmin(body: ts.Node): boolean {
    let found = false;
    function visit(node: ts.Node) {
        if (found) return;
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'requireSameOriginAdmin'
        ) {
            found = true;
            return;
        }
        // Also accept `await requireSameOriginAdmin(...)` (via AwaitExpression wrapping the call).
        node.forEachChild(visit);
    }
    body.forEachChild(visit);
    return found;
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
            report.skipped.push(`SKIP (exempt comment): ${relative}::${name}`);
            return;
        }

        if (!shouldCheckFunction(name)) {
            report.skipped.push(`SKIP (getter): ${relative}::${name}`);
            return;
        }

        if (!body) {
            report.failed.push(`MISSING BODY: ${relative}::${name}`);
            return;
        }

        if (!functionCallsRequireSameOriginAdmin(body)) {
            report.failed.push(
                `MISSING requireSameOriginAdmin: ${relative}:${lineOf(owner)} ${name} must call requireSameOriginAdmin() or carry '@action-origin-exempt: <reason>' comment`,
            );
            return;
        }

        report.passed.push(`OK: ${relative}::${name}`);
    };

    for (const statement of sourceFile.statements) {
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
                evaluateBody(declaration, init.body, name);
                continue;
            }
            // Function expression: `async function (...) {...}`
            if (ts.isFunctionExpression(init)) {
                const funcModifiers = ts.getModifiers(init);
                const isAsync = !!funcModifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
                if (!isAsync) continue;
                const name = declaration.name.text;
                evaluateBody(declaration, init.body, name);
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
    for (const file of ACTION_FILES) {
        checkActionFile(file);
    }

    if (failed) {
        console.error('\nOne or more mutating server actions are missing the same-origin provenance check.');
        console.error('Fix by calling `requireSameOriginAdmin()` or documenting an explicit exemption.');
        process.exit(1);
    }

    console.log('\nAll mutating server actions enforce same-origin provenance.');
    process.exit(0);
}
