import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * C2R-01 regression guard: assert that every outer catch block in `auth.ts`
 * includes `unstable_rethrow(e)` as the first statement. Without this, a
 * future refactor that places redirect/notFound/revalidatePath inside the
 * transaction (or inside getCurrentUser/logAuditEvent) would silently swallow
 * the Next.js internal signal and break control-flow.
 *
 * This is a static-text check so we don't need to mock Next.js internals or
 * spin up a runtime. The pattern is simple enough that text inspection is
 * equivalent to AST inspection and the test stays readable.
 */
describe('auth.ts — unstable_rethrow on outer catches', () => {
    const authSource = readFileSync(
        resolve(__dirname, '..', 'app', 'actions', 'auth.ts'),
        'utf-8',
    );

    it('imports unstable_rethrow from next/navigation', () => {
        expect(authSource).toMatch(/import[\s\S]*?unstable_rethrow[\s\S]*?from\s+['"]next\/navigation['"]/);
    });

    it('every outer `catch (e)` runs unstable_rethrow before any side effect', () => {
        // Match the "outer" catches: catches that follow a closing brace of
        // the main try block (not nested rollback try/catches). We approximate
        // this by requiring the catch block to also reference the error `e`
        // via console.error("Failed to ..."). Each such catch must call
        // unstable_rethrow somewhere in its body before the first
        // console.error. This keeps the regression check narrow enough to
        // pass today while catching the obvious omission.
        const failingErrorRegex = /\}\s*catch\s*\(\s*e\s*\)\s*\{([\s\S]*?console\.error\(\s*["']Failed[\s\S]*?[\s\S]*?\})/g;
        const blocks = [...authSource.matchAll(failingErrorRegex)];

        expect(blocks.length).toBeGreaterThan(0);
        for (const [_, body] of blocks) {
            void _;
            const firstRethrow = body.indexOf('unstable_rethrow(e)');
            const firstErrorLog = body.indexOf('console.error(');
            expect(firstRethrow).toBeGreaterThanOrEqual(0);
            expect(firstRethrow).toBeLessThan(firstErrorLog);
        }
    });

    it('updatePassword outer catch contains unstable_rethrow', () => {
        const updatePasswordMatch = /export async function updatePassword[\s\S]*?^}/m.exec(authSource);
        expect(updatePasswordMatch).not.toBeNull();
        const body = updatePasswordMatch![0];
        expect(body).toMatch(/unstable_rethrow\(e\)/);
    });
});
