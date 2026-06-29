import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkActionSource, walkForActionFiles } from '../../scripts/check-action-origin';

/**
 * C5R-RPL-04 / AGG5R-06 — fixture-based coverage for the
 * `scripts/check-action-origin.ts` scanner. Locks in both the pre-existing
 * function-declaration behavior AND the new arrow-function/function-expression
 * branch added in C5R-RPL-03. Without this test, a future scanner refactor
 * could regress silently — the lint gate is load-bearing for the
 * defense-in-depth Origin/Referer check on mutating server actions.
 */

const withApprovedActionGuard = (body: string) => `
    import { requireSameOriginAdmin } from '@/lib/action-guards';
    ${body}
`;

describe('checkActionSource — function declarations', () => {
    it('fails when a mutating function declaration omits requireSameOriginAdmin', () => {
        const src = `
            export async function deleteFoo(id) {
                // no origin check
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
        expect(report.failed[0]).toContain('deleteFoo');
    });

    it('passes when a mutating function declaration calls requireSameOriginAdmin', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: actions/fixture.ts::deleteFoo']);
    });

    it('fails when requireSameOriginAdmin is hidden in an uncalled nested helper', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                async function guard() {
                    return requireSameOriginAdmin();
                }
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when requireSameOriginAdmin appears only in a dead branch', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                if (false) {
                    await requireSameOriginAdmin();
                }
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when a DB mutation happens before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                await db.delete(foo).where(eq(foo.id, id));
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when a DB mutation happens between the same-origin guard and early return', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                const originError = await requireSameOriginAdmin();
                await db.delete(foo).where(eq(foo.id, id));
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('allows non-mutating localization before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                const t = await getTranslations('serverActions');
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                if (!(await isAdmin())) return { error: t('unauthorized') };
                await db.delete(foo).where(eq(foo.id, id));
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: actions/fixture.ts::deleteFoo']);
    });

    it('fails when auth/session reads happen before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function deleteFoo(id) {
                const t = await getTranslations('serverActions');
                if (!(await isAdmin())) return { error: t('unauthorized') };
                const user = await getCurrentUser();
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                await db.delete(foo).where(eq(foo.id, id));
                return { success: true, userId: user?.id };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when revalidation happens before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function updateFoo(id) {
                revalidateLocalizedPaths('/admin');
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when a local helper hides a DB mutation before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            async function writeAuditBeforeGuard() {
                await db.insert(auditLog).values({ ok: true });
            }
            export async function updateFoo(id) {
                await writeAuditBeforeGuard();
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails public exempt actions when a rate-limit result is ignored before mutation', () => {
        const src = `
            /** @action-origin-exempt: public analytics action, rate-limited before write */
            export async function recordThing() {
                isViewRecordRateLimited('1.2.3.4', Date.now());
                await db.insert(views).values({ ok: true });
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/public.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('EXEMPT COMMENT ON MUTATING ACTION');
    });

    it('fails public exempt actions when catch/finally mutates before a rate-limit gate', () => {
        const src = `
            /** @action-origin-exempt: public analytics action, rate-limited before write */
            export async function recordThing() {
                try {
                    doSomething();
                } catch {
                    await db.insert(errors).values({ ok: true });
                } finally {
                    await logAuditEvent(1, 'x', 'y', 'z');
                }
                const overLimit = isViewRecordRateLimited('1.2.3.4', Date.now());
                if (overLimit) return { error: 'rateLimited' };
                await db.insert(views).values({ ok: true });
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/public.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('EXEMPT COMMENT ON MUTATING ACTION');
    });

    // R15C15 TE-15-03: the raw Next.js cache primitives (not just the project's
    // revalidate* wrappers) must count as mutations so an action calling them
    // before the same-origin guard is flagged.
    it('fails when raw revalidatePath happens before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function updateFoo(id) {
                revalidatePath('/admin');
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when raw revalidateTag happens before the same-origin guard', () => {
        const src = withApprovedActionGuard(`
            export async function updateFoo(id) {
                revalidateTag('images');
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('requires explicit exemptions for getter-style function declarations', () => {
        const src = `
            export async function getFoo() {
                return [];
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.skipped).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
        expect(report.failed[0]).toContain('getFoo');
    });

    it('respects the @action-origin-exempt leading comment', () => {
        const src = `
            /** @action-origin-exempt: unit-test fixture */
            export async function mutateFoo(id) {
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.skipped).toContain('SKIP (exempt comment): actions/fixture.ts::mutateFoo');
    });

    // R4C2 SEC-R4C2-02: exemption comments must not silence verification of
    // mutating actions — that let `createLrToken` opt out of the gate while
    // minting credentials, so a future guard removal would have shipped with
    // lint:action-origin green.
    it('fails when an exempt comment sits on a body with a direct DB mutation', () => {
        const src = `
            /** @action-origin-exempt: bogus — this body mutates */
            export async function createThing(opts) {
                await db.insert(things).values(opts);
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.skipped).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('EXEMPT COMMENT ON MUTATING ACTION');
        expect(report.failed[0]).toContain('createThing');
    });

    it('fails when an exempt comment sits on a body calling logAuditEvent (arrow form)', () => {
        const src = `
            /** @action-origin-exempt: bogus — audit write is a mutation */
            export const auditThing = async (id) => {
                await logAuditEvent(1, 'x', 'y', String(id));
                return { success: true };
            };
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.skipped).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('EXEMPT COMMENT ON MUTATING ACTION');
        expect(report.failed[0]).toContain('auditThing');
    });

    it('still skips exempt read-only bodies that only db.select', () => {
        const src = `
            /** @action-origin-exempt: read-only admin getter */
            export async function listThings() {
                return db.select().from(things).orderBy(things.name);
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.skipped).toContain('SKIP (exempt comment): actions/fixture.ts::listThings');
    });

    it('passes a guard-carrying mutating action WITHOUT an exempt comment (createLrToken shape)', () => {
        const src = withApprovedActionGuard(`
            export async function createToken(opts) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                await db.insert(tokens).values(opts);
                await logAuditEvent(1, 'created', 'token', '1');
                return { success: true };
            }
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toContain('OK: actions/fixture.ts::createToken');
    });
});

describe('checkActionSource — arrow-function exports (C5R-RPL-03 / AGG5R-01)', () => {
    it('fails when a mutating arrow-function export omits requireSameOriginAdmin', () => {
        const src = `
            export const deleteFoo = async (id) => {
                return { success: true };
            };
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
        expect(report.failed[0]).toContain('deleteFoo');
    });

    it('passes when a mutating arrow-function export returns on the requireSameOriginAdmin result', () => {
        const src = withApprovedActionGuard(`
            export const deleteFoo = async (id) => {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            };
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: actions/fixture.ts::deleteFoo']);
    });

    it('fails when a mutating arrow-function export ignores the requireSameOriginAdmin result', () => {
        const src = withApprovedActionGuard(`
            export const deleteFoo = async (id) => {
                const originError = await requireSameOriginAdmin();
                return { success: true };
            };
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
        expect(report.failed[0]).toContain('deleteFoo');
    });

    it('requires explicit exemptions for getter-style arrow-function exports', () => {
        const src = `
            export const getFoo = async () => [];
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.skipped).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
        expect(report.failed[0]).toContain('getFoo');
    });

    it('ignores non-async arrow-function exports (not a server action)', () => {
        const src = `
            export const deleteFoo = (id) => ({ success: true });
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual([]);
        expect(report.skipped).toEqual([]);
    });

    it('handles concise-body arrow functions (no block)', () => {
        const src = `
            export const deleteFoo = async (id) => doSomething(id);
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        // Concise body with a single call expression that isn't requireSameOriginAdmin
        // should flag as missing.
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });
});

describe('checkActionSource — function-expression exports', () => {
    it('fails when a mutating function-expression export omits requireSameOriginAdmin', () => {
        const src = `
            export const deleteFoo = async function (id) {
                return { success: true };
            };
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('passes when a mutating function-expression calls requireSameOriginAdmin', () => {
        const src = withApprovedActionGuard(`
            export const deleteFoo = async function (id) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            };
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: actions/fixture.ts::deleteFoo']);
    });
});

describe('walkForActionFiles — recursive action discovery (C6R-RPL-02 / AGG6R-01)', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'action-origin-walk-'));
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('discovers .ts files in nested subdirectories', () => {
        fs.writeFileSync(path.join(tempRoot, 'top.ts'), '// top');
        fs.mkdirSync(path.join(tempRoot, 'sub'));
        fs.writeFileSync(path.join(tempRoot, 'sub', 'nested.ts'), '// nested');
        fs.mkdirSync(path.join(tempRoot, 'sub', 'deep'));
        fs.writeFileSync(path.join(tempRoot, 'sub', 'deep', 'deeper.ts'), '// deeper');

        const found = walkForActionFiles(tempRoot).map((p) => path.relative(tempRoot, p)).sort();
        expect(found).toEqual([
            path.join('sub', 'deep', 'deeper.ts'),
            path.join('sub', 'nested.ts'),
            'top.ts',
        ]);
    });

    it('skips non-action source files', () => {
        fs.writeFileSync(path.join(tempRoot, 'keep.ts'), '// keep');
        fs.writeFileSync(path.join(tempRoot, 'keep-js.js'), '// keep');
        fs.writeFileSync(path.join(tempRoot, 'skip.md'), '# skip');

        const found = walkForActionFiles(tempRoot).map((p) => path.relative(tempRoot, p)).sort();
        expect(found).toEqual(['keep-js.js', 'keep.ts']);
    });

    it('excludes auth.* but keeps public.* covered by public-action checks', () => {
        fs.writeFileSync(path.join(tempRoot, 'auth.ts'), '// top auth');
        fs.writeFileSync(path.join(tempRoot, 'public.tsx'), '// top public');
        fs.mkdirSync(path.join(tempRoot, 'sub'));
        fs.writeFileSync(path.join(tempRoot, 'sub', 'auth.ts'), '// nested auth');
        fs.writeFileSync(path.join(tempRoot, 'sub', 'keep.ts'), '// keep');

        const found = walkForActionFiles(tempRoot).map((p) => path.relative(tempRoot, p));
        expect(found).toContain(path.join('sub', 'keep.ts'));
        expect(found.find((p) => p.endsWith('auth.ts'))).toBeUndefined();
        expect(found.find((p) => p.endsWith('public.tsx'))).toBeDefined();
    });
});

describe('checkActionSource — mixed file', () => {
    it('reports each export independently', () => {
        const src = withApprovedActionGuard(`
            /** @action-origin-exempt: read-only fixture */
            export async function getFoo() { return []; }
            export async function updateFoo(id) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            }
            export const deleteFoo = async (id) => {
                return { success: true };
            };
            export const createFoo = async (data) => {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            };
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.skipped).toContain('SKIP (exempt comment): actions/fixture.ts::getFoo');
        expect(report.passed).toContain('OK: actions/fixture.ts::updateFoo');
        expect(report.passed).toContain('OK: actions/fixture.ts::createFoo');
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('deleteFoo');
    });
});

describe('checkActionSource — aliased exports', () => {
    it('fails closed for aliased mutating exports that the scanner cannot inspect', () => {
        const src = withApprovedActionGuard(`
            const deleteFoo = async (id) => {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                return { success: true };
            };
            export { deleteFoo };
        `);
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('UNSUPPORTED aliased export');
        expect(report.failed[0]).toContain('deleteFoo');
    });

    it('fails closed for star re-exports that can hide mutating actions', () => {
        const src = `
            export * from './mutating-actions';
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('STAR RE-EXPORT');
    });
});

describe('checkActionSource — approved guard import source', () => {
    it('fails when a local function spoofs requireSameOriginAdmin', () => {
        const src = `
            function requireSameOriginAdmin() { return null; }
            export async function deleteFoo(id) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                await db.delete(foo).where(eq(foo.id, id));
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('fails when requireSameOriginAdmin is imported from an unapproved module', () => {
        const src = `
            import { requireSameOriginAdmin } from './fake-action-guards';
            export async function deleteFoo(id) {
                const originError = await requireSameOriginAdmin();
                if (originError) return { error: originError };
                await db.delete(foo).where(eq(foo.id, id));
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed[0]).toContain('MISSING requireSameOriginAdmin');
    });

    it('passes when the approved guard is imported under an alias', () => {
        const src = `
            import { requireSameOriginAdmin as checkActionOrigin } from '@/lib/action-guards';
            export async function deleteFoo(id) {
                const originError = await checkActionOrigin();
                if (originError) return { error: originError };
                await db.delete(foo).where(eq(foo.id, id));
                return { success: true };
            }
        `;
        const report = checkActionSource(src, 'actions/fixture.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: actions/fixture.ts::deleteFoo']);
    });
});


describe('walkForActionFiles — extension coverage', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-origin-ext-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('discovers TS/TSX/JS action files while excluding auth by basename', () => {
        fs.writeFileSync(path.join(tempDir, 'images.ts'), '');
        fs.writeFileSync(path.join(tempDir, 'albums.tsx'), '');
        fs.writeFileSync(path.join(tempDir, 'legacy.js'), '');
        fs.writeFileSync(path.join(tempDir, 'public.tsx'), '');
        fs.writeFileSync(path.join(tempDir, 'auth.js'), '');
        fs.writeFileSync(path.join(tempDir, 'notes.md'), '');

        const discovered = walkForActionFiles(tempDir).map((file) => path.basename(file)).sort();
        expect(discovered).toEqual(['albums.tsx', 'images.ts', 'legacy.js', 'public.tsx']);
    });
});

describe('checkActionSource — public analytics actions', () => {
    it('allows an exempt public mutation only when rate-limited before insert', () => {
        const src = `
            /** @action-origin-exempt: public analytics endpoint */
            export async function recordView(id) {
                const params = await buildViewParams(await headers());
                if (isViewRecordRateLimited(params.ip, Date.now())) return;
                db.insert(imageViews).values({ imageId: id });
            }
        `;
        const report = checkActionSource(src, 'src/app/actions/public.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toContain('OK (public rate-limited action): src/app/actions/public.ts::recordView');
    });

    it('allows an exempt public mutation when a try block rate-limits before insert', () => {
        const src = `
            /** @action-origin-exempt: public analytics endpoint */
            export async function recordView(id) {
                try {
                    const params = await buildViewParams(await headers());
                    if (isViewRecordRateLimited(params.ip, Date.now())) return;
                    db.insert(imageViews).values({ imageId: id }).catch(console.debug);
                } catch {}
            }
        `;
        const report = checkActionSource(src, 'src/app/actions/public.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toContain('OK (public rate-limited action): src/app/actions/public.ts::recordView');
    });

    it('fails an exempt public mutation without a pre-insert public rate limit', () => {
        const src = `
            /** @action-origin-exempt: public analytics endpoint */
            export async function recordView(id) {
                db.insert(imageViews).values({ imageId: id });
            }
        `;
        const report = checkActionSource(src, 'src/app/actions/public.ts');
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('EXEMPT COMMENT ON MUTATING ACTION');
    });
});
