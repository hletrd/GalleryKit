import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Plan 333 / C1F-CR-04 / C1F-SR-01.
 *
 * Locks the source-level invariant that outer catch blocks in login() and
 * updatePassword() do NOT roll back pre-incremented rate-limit counters on
 * unexpected infrastructure errors. Rolling back reduces the failed-attempt
 * budget, giving attackers extra attempts when they can trigger infrastructure
 * errors (e.g. by overloading the DB).
 *
 * Why fixture-style instead of behavioral:
 *   The auth actions depend on headers(), cookies(), argon2, db, and i18n.
 *   Mocking all of these for a behavioral test is a large, fragile lift.
 *   The regression risk is a refactor that accidentally re-introduces a
 *   rollback call in the outer catch — exactly what fixture inspection catches.
 */

const authPath = path.join(__dirname, '..', 'app', 'actions', 'auth.ts');
const authSource = fs.readFileSync(authPath, 'utf8');

describe('auth rate-limit rollback — C1F-CR-04 / C1F-SR-01 invariants', () => {
    it('login outer catch block does NOT call rollbackLoginRateLimit or rollbackAccountLoginRateLimit', () => {
        const outerCatchBody = extractOuterCatchBody(authSource, 'export async function login');
        expect(outerCatchBody, 'login outer catch body must be findable').toBeTruthy();

        // The C1F-CR-04 comment must be present to explain the no-rollback policy
        expect(outerCatchBody!).toMatch(/C1F-CR-04|C1F-SR-01/);

        // Neither rollback function may appear in the outer catch block.
        // They ARE allowed in the tooManyAttempts early-return path (before auth work).
        expect(outerCatchBody!).not.toMatch(/rollbackLoginRateLimit\s*\(/);
        expect(outerCatchBody!).not.toMatch(/rollbackAccountLoginRateLimit\s*\(/);
    });

    it('updatePassword outer catch block does NOT call rollbackPasswordChangeRateLimit', () => {
        const outerCatchBody = extractOuterCatchBody(authSource, 'export async function updatePassword');
        expect(outerCatchBody, 'updatePassword outer catch body must be findable').toBeTruthy();

        expect(outerCatchBody!).toMatch(/C1F-CR-04|C1F-SR-01/);
        expect(outerCatchBody!).not.toMatch(/rollbackPasswordChangeRateLimit\s*\(/);
    });

    it('source parser scopes each outer catch to the requested function body', () => {
        const loginOuterCatchBody = extractOuterCatchBody(authSource, 'export async function login');
        const updatePasswordOuterCatchBody = extractOuterCatchBody(authSource, 'export async function updatePassword');

        expect(loginOuterCatchBody, 'login outer catch body must be findable').toBeTruthy();
        expect(updatePasswordOuterCatchBody, 'updatePassword outer catch body must be findable').toBeTruthy();
        expect(loginOuterCatchBody).not.toBe(updatePasswordOuterCatchBody);
        expect(loginOuterCatchBody).toContain('Login verification failed');
        expect(loginOuterCatchBody).not.toContain('Failed to update password');
        expect(updatePasswordOuterCatchBody).toContain('Failed to update password');
        expect(updatePasswordOuterCatchBody).not.toContain('Login verification failed');
    });

    it('rollback imports exist for the tooManyAttempts early-return paths', () => {
        // The rollback helpers must still be imported — they are used in the
        // pre-auth tooManyAttempts rejection path where rolling back is correct
        // because no authentication work was performed.
        expect(authSource).toMatch(/import\s*\{[^}]*rollbackLoginRateLimit[^}]*\}/);
        expect(authSource).toMatch(/import\s*\{[^}]*rollbackAccountLoginRateLimit[^}]*\}/);
        expect(authSource).toMatch(/import\s*\{[^}]*rollbackPasswordChangeRateLimit[^}]*\}/);
    });
});

/**
 * Returns the body of the outermost catch block inside the given function.
 * This assumes the function has a single top-level try/catch with the catch
 * being the outermost one (not nested inside inner try/catches).
 */
function extractOuterCatchBody(source: string, fnHeader: string): string | null {
    const functionName = fnHeader.match(/function\s+(\w+)/)?.[1];
    if (!functionName) return null;

    const sourceFile = ts.createSourceFile(authPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fn = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
        ts.isFunctionDeclaration(statement) && statement.name?.text === functionName
    ));
    if (!fn?.body) return null;

    const outerTryStatements = fn.body.statements.filter((statement): statement is ts.TryStatement => (
        ts.isTryStatement(statement) && Boolean(statement.catchClause)
    ));
    const outerTry = outerTryStatements.at(-1);
    const catchBlock = outerTry?.catchClause?.block;
    if (!catchBlock) return null;

    return source.slice(catchBlock.getStart(sourceFile) + 1, catchBlock.end - 1);
}
