import { describe, it, expect } from 'vitest';
import { checkPublicRouteSource } from '../../scripts/check-public-route-rate-limit';

describe('checkPublicRouteSource', () => {
    it('passes function declaration export with rate-limit helper', () => {
        const source = `
            import { preIncrementCheckoutAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (preIncrementCheckoutAttempt('1.2.3.4')) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('passes variable export with rate-limit helper', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export const POST = async (request) => {
                if (preIncrementSemanticAttempt('1.2.3.4', Date.now())) return { status: 429 };
                return { status: 200 };
            };
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('fails export specifier form without rate-limit helper (C1-BUG-02)', () => {
        const source = `
            async function handler(request) {
                return { status: 200 };
            }
            export { handler as POST };
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
        expect(result.failed[0]).toContain('POST');
    });

    it('passes export specifier form with rate-limit helper', () => {
        const source = `
            import { preIncrementCheckoutAttempt } from '@/lib/rate-limit';
            async function handler(request) {
                if (preIncrementCheckoutAttempt('1.2.3.4')) return { status: 429 };
                return { status: 200 };
            }
            export { handler as POST };
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('passes non-function export named POST (C1-BUG-04)', () => {
        const source = `
            export const POST = 42;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating handlers'))).toBe(true);
    });

    it('fails export with call-wrapper but no rate-limit helper', () => {
        const source = `
            function wrap(fn) { return fn; }
            export const POST = wrap(async (request) => {
                return { status: 200 };
            });
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('passes with exempt tag in comment (C1-BUG-05)', () => {
        const source = `
            // @public-no-rate-limit-required: webhook is gated by signature
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('carries @public-no-rate-limit-required'))).toBe(true);
    });

    it('fails when exempt tag is inside string literal (C1-BUG-05)', () => {
        const source = `
            const docs = "See @public-no-rate-limit-required for details";
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when rate-limit helper is only in a line comment (C12-LOW-01)', () => {
        const source = `
            // preIncrementSemanticAttempt(ip, now);
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when rate-limit helper is only in a block comment (C12-LOW-01)', () => {
        const source = `
            /* preIncrementCheckoutAttempt(ip) */
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when rate-limit helper spans inside a multi-line block comment (C12-LOW-01)', () => {
        const source = `
            /*
             * preIncrementSemanticAttempt(ip, now);
             */
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('passes when rate-limit helper is actually called (not commented)', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (preIncrementSemanticAttempt('1.2.3.4', Date.now())) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('passes when no mutating handlers exist', () => {
        const source = `
            export async function GET(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating handlers'))).toBe(true);
    });

    it('fails mutating handler without rate limit or exempt tag', () => {
        const source = `
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
        expect(result.failed[0]).toContain('POST');
    });

    it('passes with exact-prefix helper name (no suffix) (C19-AGG-03)', () => {
        const source = `
            import { preIncrement } from '@/lib/rate-limit';
            export async function POST(request) {
                if (preIncrement('1.2.3.4')) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('detects PUT/PATCH/DELETE as mutating handlers', () => {
        const source = `
            export async function PUT(request) {
                return { status: 200 };
            }
            export async function DELETE(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('PUT');
        expect(result.failed[0]).toContain('DELETE');
    });
});
