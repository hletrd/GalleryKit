import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkPublicRouteSource } from '../../scripts/check-public-route-rate-limit';

describe('checkPublicRouteSource', () => {
    it('passes function declaration export with rate-limit helper', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (preIncrementShareAttempt('1.2.3.4')) return { status: 429 };
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

    it('fails exported mutating handler aliases without a rate-limit helper', () => {
        const source = `
            const handler = async (request) => {
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            };
            export const POST = handler;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
        expect(result.failed[0]).toContain('POST');
    });

    it('passes exported mutating handler aliases with a rate-limit helper', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            const handler = async (request) => {
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            };
            export const POST = handler;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('fails exported expensive GET handler aliases without a rate-limit helper', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            const handler = async () => {
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            };
            export const GET = handler;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('passes exported cheap GET handler aliases', () => {
        const source = `
            const handler = async () => Response.json({ ok: true });
            export const GET = handler;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
    });

    it('fails closed on unresolved exported handler aliases', () => {
        const source = `
            export const GET = handler;
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('UNSUPPORTED HANDLER ALIAS');
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
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function handler(request) {
                if (preIncrementShareAttempt('1.2.3.4')) return { status: 429 };
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
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
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

    it('passes cheap GET handlers without a limiter', () => {
        const source = `
            export async function GET() {
                return Response.json({ status: 'ok' });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
    });

    it('fails expensive public GET handlers without a limiter', () => {
        const source = `
            import { db } from '@/db';
            export async function GET() {
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('passes expensive public GET handlers with a rate-limit helper', () => {
        const source = `
            import { db } from '@/db';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                if (preIncrementSemanticAttempt('203.0.113.10', Date.now())) return Response.json({}, { status: 429 });
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('expensive GET uses rate-limit helper'))).toBe(true);
    });

    it('fails expensive public GET handlers when the limiter appears after expensive work', () => {
        const source = `
            import { db } from '@/db';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                const rows = await db.select().from(images).limit(10);
                if (preIncrementSemanticAttempt('203.0.113.10', Date.now())) return Response.json({}, { status: 429 });
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('fails closed for concise expensive public GET bodies with protected work before a later limiter', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export const GET = async () => (
                await db.select().from(images),
                preIncrementShareAttempt('1.2.3.4')
                    ? new Response(null, { status: 429 })
                    : Response.json({ ok: true })
            );
        `;
        const result = checkPublicRouteSource(source, 'src/app/api/foo/route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('fails closed for concise expensive public HEAD bodies with protected work before a later limiter', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export const HEAD = async () => (
                await db.select().from(images),
                preIncrementShareAttempt('1.2.3.4')
                    ? new Response(null, { status: 429 })
                    : new Response(null, { status: 204 })
            );
        `;
        const result = checkPublicRouteSource(source, 'src/app/api/foo/route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('passes expensive public GET handlers when a captured limiter result returns before expensive work', () => {
        const source = `
            import { db } from '@/db';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                const overLimit = preIncrementSemanticAttempt('203.0.113.10', Date.now());
                if (overLimit) return Response.json({}, { status: 429 });
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('expensive GET uses rate-limit helper'))).toBe(true);
    });

    it('fails expensive public GET handlers when a captured limiter result is checked against false', () => {
        const source = `
            import { db } from '@/db';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                const overLimit = preIncrementSemanticAttempt('203.0.113.10', Date.now());
                if (overLimit === false) return Response.json({}, { status: 429 });
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('passes expensive public GET handlers when the limiter gate is inside a try block before expensive work', () => {
        const source = `
            import { ImageResponse } from 'next/og';
            import { getSeoSettings } from '@/lib/data';
            import { preIncrementOgAttempt } from '@/lib/rate-limit';
            export async function GET() {
                try {
                    if (preIncrementOgAttempt('203.0.113.10', Date.now())) return new Response('limited', { status: 429 });
                    const seo = await getSeoSettings();
                    return new ImageResponse(<div>{seo.title}</div>);
                } catch {
                    return new Response('failed', { status: 500 });
                }
            }
        `;
        const result = checkPublicRouteSource(source, 'route.tsx');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('expensive GET uses rate-limit helper'))).toBe(true);
    });

    it('fails expensive public GET handlers when expensive catch work is not dominated by a limiter', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                try {
                    JSON.parse('{');
                    if (preIncrementSemanticAttempt('203.0.113.10', Date.now())) return Response.json({}, { status: 429 });
                } catch {
                    const rows = await db.select().from(images).limit(10);
                    return Response.json({ rows });
                }
                return Response.json({ ok: true });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('fails expensive public GET handlers when expensive finally work is not dominated by a limiter', () => {
        const source = `
            import { db } from '@/db';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                try {
                    if (Math.random() > 2) throw new Error('never');
                    if (preIncrementSemanticAttempt('203.0.113.10', Date.now())) return Response.json({}, { status: 429 });
                } finally {
                    await db.execute('SELECT 1');
                }
                return Response.json({ ok: true });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('before expensive work');
    });

    it('fails expensive public GET handlers when expensive work is hidden behind a local helper', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            async function loadRows() {
                return db.select().from(images).limit(10);
            }
            export async function GET() {
                const rows = await loadRows();
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('fails expensive public GET handlers when expensive work is hidden behind an imported upload helper', () => {
        const source = `
            import { serveUploadFile } from '@/lib/serve-upload';
            export async function GET(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'GET', request.signal);
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('fails expensive public GET handlers when DB-backed imported data helpers are called without a limiter', () => {
        const source = `
            import { getTopicBySlug } from '@/lib/data';
            export async function GET() {
                const topic = await getTopicBySlug('weddings');
                return Response.json({ topic });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('fails expensive public GET handlers when DB is imported under an alias', () => {
        const source = `
            import { db as database } from '@/db';
            import { images } from '@/db/schema';
            export async function GET() {
                const rows = await database.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('passes DB-backed imported data helpers after a limiter gate', () => {
        const source = `
            import { getTopicBySlug } from '@/lib/data';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function GET() {
                const overLimit = preIncrementSemanticAttempt('203.0.113.10', Date.now());
                if (overLimit) return Response.json({}, { status: 429 });
                const topic = await getTopicBySlug('weddings');
                return Response.json({ topic });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('expensive GET uses rate-limit helper'))).toBe(true);
    });

    it('fails expensive public GET handlers when DB-backed data helpers are called through namespace imports', () => {
        const source = `
            import * as data from '@/lib/data';
            export async function GET() {
                const latest = await data.getLatestImageForOg();
                return Response.json({ latest });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('does not treat expensive marker words inside string literals as expensive GET work', () => {
        const source = `
            export async function GET() {
                const note = 'ImageResponse and sharp are documented here, not executed';
                return Response.json({ note });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
    });

    it('does not treat expensive marker words inside comments as expensive GET work', () => {
        const source = `
            export async function GET() {
                // Future ImageResponse work belongs in a different route.
                return Response.json({ ok: true });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
    });

    it('fails expensive public GET handlers when DB-backed data helpers are imported relatively', () => {
        const source = `
            import { getTopicBySlug } from '../../../lib/data';
            export async function GET() {
                const topic = await getTopicBySlug('weddings');
                return Response.json({ topic });
            }
        `;
        const result = checkPublicRouteSource(source, 'src/app/api/topics/route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('fails expensive public GET handlers when relative DB-backed helpers use namespace imports', () => {
        const source = `
            import * as data from '../../../lib/data';
            export async function GET() {
                const topic = await data.getTopicBySlug('weddings');
                return Response.json({ topic });
            }
        `;
        const result = checkPublicRouteSource(source, 'src/app/api/topics/route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
    });

    it('allows the upload helper only with a reasoned public-route exemption', () => {
        const source = `
            import { serveUploadFile } from '@/lib/serve-upload';
            // @public-no-rate-limit-required: public derivative serving is bounded by cache validators and path containment
            export async function GET(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'GET', request.signal);
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('carries @public-no-rate-limit-required'))).toBe(true);
    });

    it('fails expensive public HEAD handlers without a limiter or exemption', () => {
        const source = `
            import { serveUploadFile } from '@/lib/serve-upload';
            export async function HEAD(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'HEAD', request.signal);
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('expensive GET');
        expect(result.failed[0]).toContain('HEAD');
    });

    it('allows expensive public HEAD handlers with a reasoned exemption', () => {
        const source = `
            import { serveUploadFile } from '@/lib/serve-upload';
            // @public-no-rate-limit-required: public derivative serving is bounded by cache validators and path containment
            export async function HEAD(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'HEAD', request.signal);
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('carries @public-no-rate-limit-required'))).toBe(true);
    });

    it('allows the paired upload GET and HEAD handlers to share one reasoned exemption', () => {
        const source = `
            import { serveUploadFile } from '@/lib/serve-upload';
            // @public-no-rate-limit-required: public derivative serving is bounded by cache validators and path containment
            export async function GET(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'GET', request.signal);
            }
            export async function HEAD(request) {
                return serveUploadFile(['jpeg', 'photo.jpg'], request.headers.get('if-none-match'), 'HEAD', request.signal);
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('carries @public-no-rate-limit-required'))).toBe(true);
    });

    it('passes expensive public GET local helper calls after a limiter gate', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            async function loadRows() {
                return db.select().from(images).limit(10);
            }
            export async function GET() {
                if (preIncrementSemanticAttempt('203.0.113.10', Date.now())) return Response.json({}, { status: 429 });
                const rows = await loadRows();
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('expensive GET uses rate-limit helper'))).toBe(true);
    });

    it('passes expensive public GET handlers with a reasoned exemption', () => {
        const source = `
            import { db } from '@/db';
            // @public-no-rate-limit-required: health check is sampled by infrastructure only
            export async function GET() {
                await db.execute('SELECT 1');
                return Response.json({ status: 'ok' });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('carries @public-no-rate-limit-required'))).toBe(true);
    });

    it('fails a file-level exemption when another mutating handler would inherit it', () => {
        const source = `
            // @public-no-rate-limit-required: webhook POST is gated by signature
            export async function POST(request) {
                return { status: 200 };
            }
            export async function DELETE(request) {
                await db.delete(images);
                return { status: 204 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('AMBIGUOUS RATE-LIMIT EXEMPTION');
        expect(result.failed[0]).toContain('POST, DELETE');
    });

    it('fails a file-level exemption when an expensive GET would inherit it from a mutating handler', () => {
        const source = `
            import { db } from '@/db';
            // @public-no-rate-limit-required: webhook POST is gated by signature
            export async function POST(request) {
                return { status: 200 };
            }
            export async function GET() {
                const rows = await db.select().from(images).limit(10);
                return Response.json({ rows });
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('AMBIGUOUS RATE-LIMIT EXEMPTION');
        expect(result.failed[0]).toContain('POST, GET');
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

    it('fails when exempt tag has no reason', () => {
        const source = `
            // @public-no-rate-limit-required
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when exempt tag reason is blank', () => {
        const source = `
            // @public-no-rate-limit-required:
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
            /* preIncrementShareAttempt(ip) */
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

    it('fails when a route only imports a rate-limit helper without calling it', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when the rate-limit helper is called only after a mutation', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                await db.insert(rows).values({ ok: true });
                if (preIncrementSemanticAttempt('1.2.3.4', Date.now())) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when the only rate-limit helper call is hidden in a nested function before a mutation', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const later = () => preIncrementSemanticAttempt('1.2.3.4', Date.now());
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a nested callback calls a rate-limit helper before the handler mutates', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                items.map(() => preIncrementSemanticAttempt('1.2.3.4', Date.now()));
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when the only rate-limit helper call is in an unreachable branch before mutation', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (false) {
                    preIncrementSemanticAttempt('1.2.3.4', Date.now());
                }
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when the only rate-limit helper call is branch-only before mutation', () => {
        const source = `
            import { preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (process.env.DEBUG_DISABLED) {
                    preIncrementSemanticAttempt('1.2.3.4', Date.now());
                }
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when only a rollback helper is called before mutation', () => {
        const source = `
            import { rollbackSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                rollbackSemanticAttempt('1.2.3.4');
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a rollback helper is aliased as a pre-increment helper', () => {
        const source = `
            import { rollbackSemanticAttempt as preIncrementSemanticAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const overLimit = preIncrementSemanticAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                await db.insert(rows).values({ ok: true });
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

    it('fails when a rate-limit result is ignored before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                preIncrementShareAttempt('1.2.3.4');
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('passes when a captured rate-limit result returns before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('uses rate-limit helper'))).toBe(true);
    });

    it('fails when a direct limiter gate is inverted before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                if (!preIncrementShareAttempt('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a captured limiter result is compared to false before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (false === overLimit) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when expensive public work runs before a mutating handler limiter', () => {
        const source = `
            import { db } from '@/db';
            import { images } from '@/db/schema';
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const rows = await db.select().from(images).limit(10);
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                await db.insert(auditRows).values({ count: rows.length });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a local helper wraps an approved rate-limit gate before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function enforceQuota(ip) {
                const overLimit = preIncrementShareAttempt(ip);
                if (overLimit) return true;
                return false;
            }
            export async function POST(request) {
                if (await enforceQuota('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a local helper inverts the rate-limit result', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function enforceQuota(ip) {
                const overLimit = preIncrementShareAttempt(ip);
                if (overLimit) return false;
                return true;
            }
            export async function POST(request) {
                if (await enforceQuota('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a local helper mutates before an approved rate-limit gate', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function writeFirst() {
                await db.insert(rows).values({ ok: true });
            }
            async function guarded(ip) {
                await writeFirst();
                const limit = preIncrementShareAttempt(ip);
                if (limit) return { status: 429 };
                return { status: 200 };
            }
            export { guarded as POST };
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when an imported side-effect helper runs before an approved rate-limit gate', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            import { writeDangerously } from '@/lib/dangerous-write';

            export async function POST(request) {
                await writeDangerously(request);
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when an imported create helper runs before an approved rate-limit gate', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            import { createSharedResource } from '@/lib/share-resources';

            export async function POST(request) {
                await createSharedResource(request);
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when mutation is hidden behind two local helper calls before the rate-limit gate', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function actuallyWrite() {
                await db.insert(rows).values({ ok: true });
            }
            async function writeFirst() {
                await actuallyWrite();
            }
            export async function POST(request) {
                await writeFirst();
                const overLimit = preIncrementShareAttempt('1.2.3.4');
                if (overLimit) return { status: 429 };
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a local helper wraps an ignored rate-limit call before mutation', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            async function enforceQuota(ip) {
                preIncrementShareAttempt(ip);
                return false;
            }
            export async function POST(request) {
                if (await enforceQuota('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('passes when no mutating or expensive GET handlers exist', () => {
        const source = `
            export async function GET(request) {
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(0);
        expect(result.passed.some(p => p.includes('no mutating or expensive GET handlers'))).toBe(true);
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

    it('fails when a local helper spoofs a rate-limit prefix', () => {
        const source = `
            function preIncrementNoop() { return false; }
            export async function POST(request) {
                if (preIncrementNoop()) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when a helper prefix is imported from an unapproved module', () => {
        const source = `
            import { preIncrementNoop } from './not-rate-limit';
            export async function POST(request) {
                if (preIncrementNoop()) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when an approved rate-limit import is shadowed by a handler parameter', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request, preIncrementShareAttempt = () => false) {
                if (preIncrementShareAttempt('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when an approved rate-limit import is shadowed by an arrow handler parameter', () => {
        const source = `
            import { checkAndIncrementSearchAttempt } from '@/lib/rate-limit';
            export const POST = async (request, checkAndIncrementSearchAttempt = () => false) => {
                if (checkAndIncrementSearchAttempt('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            };
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
    });

    it('fails when an approved rate-limit import is shadowed inside the handler body', () => {
        const source = `
            import { preIncrementShareAttempt } from '@/lib/rate-limit';
            export async function POST(request) {
                const preIncrementShareAttempt = () => false;
                if (preIncrementShareAttempt('1.2.3.4')) return { status: 429 };
                await db.insert(rows).values({ ok: true });
                return { status: 200 };
            }
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('MISSING RATE LIMIT');
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

    it('fails closed on star re-exports that can hide mutating handlers (OBS-R4C19-C)', () => {
        // `export * from` re-exports every named export of the target module
        // — including POST handlers this scanner cannot see. Previously this
        // shape passed as "no mutating handlers" (fail-open) while the
        // sibling admin-auth gate failed closed on the same shape.
        const source = `
            export * from './handlers';
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('STAR RE-EXPORT');
    });

    it('fails closed on named GET re-exports from another module', () => {
        // Bodyless GET re-exports hide whether the target performs DB, image,
        // filesystem, or embedding work, so they must be local or exempt.
        const source = `
            export { GET } from './handlers';
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('UNSUPPORTED GET RE-EXPORT');
    });

    it('fails closed on named HEAD re-exports from another module', () => {
        const source = `
            export { HEAD } from './handlers';
        `;
        const result = checkPublicRouteSource(source, 'route.ts');
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toContain('UNSUPPORTED HEAD RE-EXPORT');
    });
});

describe('check-public-route-rate-limit CLI discovery guard', () => {
    it('fails closed when public route discovery finds zero files', () => {
        const source = readFileSync(path.join(process.cwd(), 'scripts/check-public-route-rate-limit.ts'), 'utf8');
        expect(source).toContain("path.resolve(__dirname, '../src/app')");
        expect(source).toContain('No public route files found under');
        expect(source).toContain('process.exit(1)');
    });

    it('discovers public route handlers outside src/app/api', () => {
        const source = readFileSync(path.join(process.cwd(), 'scripts/check-public-route-rate-limit.ts'), 'utf8');
        expect(source).toContain('findRouteFiles(APP_DIR)');
        expect(source).toContain('filter(isPublicRouteFile)');
        expect(source).not.toContain('findRouteFiles(API_DIR)');
    });
});
