import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
    const headerIdx = source.indexOf(fnHeader);
    if (headerIdx === -1) return null;

    // Find the function body start
    const openBrace = source.indexOf('{', headerIdx);
    if (openBrace === -1) return null;

    let depth = 0;
    let i = openBrace;
    let inString: '"' | "'" | '`' | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
        } else if (inString) {
            if (ch === '\\') {
                i++;
            } else if (ch === inString) {
                inString = null;
            }
        } else if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
        } else if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
        }
        i++;
    }

    // Now scan backward from end of function to find the outer catch block.
    // Look for the pattern: `} catch (` near the end of the function.
    const fnEnd = i;
    const catchPattern = /}\s*catch\s*\(\s*\w*\s*\)\s*\{/g;
    let lastCatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = catchPattern.exec(source.slice(headerIdx, fnEnd))) !== null) {
        lastCatch = match;
    }
    if (!lastCatch) return null;

    const catchOpenBrace = source.indexOf('{', headerIdx + lastCatch.index + lastCatch[0].length - 1);
    if (catchOpenBrace === -1 || catchOpenBrace >= fnEnd) return null;

    // Extract the catch block body using brace depth
    let catchDepth = 1;
    let j = catchOpenBrace + 1;
    inString = null;
    inLineComment = false;
    inBlockComment = false;

    while (j < fnEnd) {
        const ch = source[j];
        const next = source[j + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                j++;
            }
        } else if (inString) {
            if (ch === '\\') {
                j++;
            } else if (ch === inString) {
                inString = null;
            }
        } else if (ch === '/' && next === '/') {
            inLineComment = true;
            j++;
        } else if (ch === '/' && next === '*') {
            inBlockComment = true;
            j++;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
        } else if (ch === '{') {
            catchDepth++;
        } else if (ch === '}') {
            catchDepth--;
            if (catchDepth === 0) {
                return source.slice(catchOpenBrace + 1, j);
            }
        }
        j++;
    }
    return null;
}
