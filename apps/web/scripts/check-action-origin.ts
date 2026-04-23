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

let failed = false;

function checkActionFile(file: string) {
    if (!fs.existsSync(file)) {
        console.error(`MISSING FILE: ${file}`);
        failed = true;
        return;
    }
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of sourceFile.statements) {
        if (!ts.isFunctionDeclaration(statement)) continue;
        const modifiers = ts.getModifiers(statement);
        const isExported = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const isAsync = !!modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
        if (!isExported || !isAsync || !statement.name) continue;

        const name = statement.name.text;
        if (!shouldCheckFunction(name)) {
            console.log(`SKIP (getter): ${relative}::${name}`);
            continue;
        }

        if (hasExemptComment(statement, content)) {
            console.log(`SKIP (exempt comment): ${relative}::${name}`);
            continue;
        }

        if (!statement.body) {
            console.error(`MISSING BODY: ${relative}::${name}`);
            failed = true;
            continue;
        }

        if (!functionCallsRequireSameOriginAdmin(statement.body)) {
            const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line + 1;
            console.error(`MISSING requireSameOriginAdmin: ${relative}:${line} ${name} must call requireSameOriginAdmin() or carry '@action-origin-exempt: <reason>' comment`);
            failed = true;
            continue;
        }

        console.log(`OK: ${relative}::${name}`);
    }
}

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
