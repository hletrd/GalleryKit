/**
 * US-P31: Public reaction toggle endpoint.
 *
 * POST /api/reactions/[imageId]
 *   - Requires same-origin (no admin auth)
 *   - Sets/reads gk_visitor cookie (HMAC-SHA256-signed, daily rotation)
 *   - Rate-limits: 10 toggles/min per visitor, 60/min per IP
 *   - Toggles like in image_reactions; atomically updates images.reaction_count
 *
 * GET /api/reactions/[imageId]
 *   - Returns { reactionCount, liked } for the current visitor
 *   - No rate-limit (read-only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { db } from '@/db';
import { images, imageReactions } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getClientIp } from '@/lib/rate-limit';
import {
    verifyVisitorCookie,
    createVisitorCookie,
    computeVisitorIdHash,
    visitorCookieOptions,
    VISITOR_COOKIE_NAME,
    signVisitorCookie,
} from '@/lib/visitor-cookie';
import {
    checkAndIncrementVisitorReaction,
    checkAndIncrementIpReaction,
    rollbackVisitorReaction,
    rollbackIpReaction,
} from '@/lib/reaction-rate-limit';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

async function getOrCreateVisitor(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<{
    uuid: string;
    date: string;
    isNew: boolean;
    newCookieValue?: string;
}> {
    const raw = cookieStore.get(VISITOR_COOKIE_NAME)?.value;
    if (raw) {
        const parsed = await verifyVisitorCookie(raw);
        if (parsed) {
            return { uuid: parsed.uuid, date: parsed.date, isNew: false };
        }
    }
    // Create new visitor
    const { uuid, cookieValue } = await createVisitorCookie();
    const today = new Date().toISOString().slice(0, 10);
    return { uuid, date: today, isNew: true, newCookieValue: cookieValue };
}

async function getReactionsEnabled(): Promise<boolean> {
    try {
        const { adminSettings } = await import('@/db/schema');
        const rows = await db
            .select({ value: adminSettings.value })
            .from(adminSettings)
            .where(eq(adminSettings.key, 'reactions_enabled'))
            .limit(1);
        const val = rows[0]?.value;
        if (val === 'false') return false;
        return true;
    } catch {
        return true; // fail open for reads
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
    const { imageId: imageIdStr } = await params;
    const imageId = parseInt(imageIdStr, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const cookieStore = await cookies();
    const raw = cookieStore.get(VISITOR_COOKIE_NAME)?.value;
    let visitorIdHash: string | null = null;

    if (raw) {
        const parsed = await verifyVisitorCookie(raw);
        if (parsed) {
            visitorIdHash = computeVisitorIdHash(parsed.uuid, parsed.date);
        }
    }

    try {
        // Get reaction count from images table
        const imageRow = await db
            .select({ reactionCount: images.reaction_count })
            .from(images)
            .where(eq(images.id, imageId))
            .limit(1);

        if (!imageRow[0]) {
            return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS });
        }

        const reactionCount = imageRow[0].reactionCount ?? 0;
        let liked = false;

        if (visitorIdHash) {
            const reactionRow = await db
                .select({ id: imageReactions.id })
                .from(imageReactions)
                .where(and(
                    eq(imageReactions.imageId, imageId),
                    eq(imageReactions.visitorIdHash, visitorIdHash),
                ))
                .limit(1);
            liked = reactionRow.length > 0;
        }

        return NextResponse.json({ reactionCount, liked }, { headers: NO_STORE_HEADERS });
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
    const { imageId: imageIdStr } = await params;
    const imageId = parseInt(imageIdStr, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Same-origin check (state change)
    const requestHeaders = request.headers;
    if (!hasTrustedSameOrigin(requestHeaders)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    if (isRestoreMaintenanceActive()) {
        return NextResponse.json({ error: 'Maintenance' }, { status: 503, headers: NO_STORE_HEADERS });
    }

    // Check reactions_enabled setting
    const reactionsEnabled = await getReactionsEnabled();
    if (!reactionsEnabled) {
        return NextResponse.json({ error: 'Reactions disabled' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const cookieStore = await cookies();
    const { uuid, date, isNew, newCookieValue } = await getOrCreateVisitor(cookieStore);
    const visitorIdHash = computeVisitorIdHash(uuid, date);

    // Rate-limit: per-visitor key (hash of uuid+date = visitorIdHash is fine as key)
    const requestHeadersForIp = await headers();
    const ip = getClientIp(requestHeadersForIp);
    const now = Date.now();

    const visitorOverLimit = checkAndIncrementVisitorReaction(visitorIdHash, now);
    const ipOverLimit = checkAndIncrementIpReaction(ip, now);

    if (visitorOverLimit || ipOverLimit) {
        rollbackVisitorReaction(visitorIdHash);
        rollbackIpReaction(ip);
        return NextResponse.json(
            { error: 'Rate limited' },
            { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } }
        );
    }

    try {
        // Check image exists
        const imageRow = await db
            .select({ id: images.id, reactionCount: images.reaction_count })
            .from(images)
            .where(eq(images.id, imageId))
            .limit(1);

        if (!imageRow[0]) {
            rollbackVisitorReaction(visitorIdHash);
            rollbackIpReaction(ip);
            return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS });
        }

        // Check existing reaction
        const existingReaction = await db
            .select({ id: imageReactions.id })
            .from(imageReactions)
            .where(and(
                eq(imageReactions.imageId, imageId),
                eq(imageReactions.visitorIdHash, visitorIdHash),
            ))
            .limit(1);

        let liked: boolean;
        let reactionCount: number;

        if (existingReaction.length > 0) {
            // Toggle off: delete reaction and decrement count atomically
            await db.transaction(async (tx) => {
                await tx
                    .delete(imageReactions)
                    .where(and(
                        eq(imageReactions.imageId, imageId),
                        eq(imageReactions.visitorIdHash, visitorIdHash),
                    ));
                await tx
                    .update(images)
                    .set({ reaction_count: sql`GREATEST(${images.reaction_count} - 1, 0)` })
                    .where(eq(images.id, imageId));
            });
            liked = false;
            reactionCount = Math.max((imageRow[0].reactionCount ?? 0) - 1, 0);
        } else {
            // Toggle on: insert reaction and increment count atomically
            await db.transaction(async (tx) => {
                await tx.insert(imageReactions).values({
                    imageId,
                    visitorIdHash,
                });
                await tx
                    .update(images)
                    .set({ reaction_count: sql`${images.reaction_count} + 1` })
                    .where(eq(images.id, imageId));
            });
            liked = true;
            reactionCount = (imageRow[0].reactionCount ?? 0) + 1;
        }

        const response = NextResponse.json({ reactionCount, liked }, { headers: NO_STORE_HEADERS });

        // Set visitor cookie if new or refreshed
        if (isNew && newCookieValue) {
            const opts = visitorCookieOptions();
            response.cookies.set(VISITOR_COOKIE_NAME, newCookieValue, opts);
        } else if (!isNew) {
            // Re-issue cookie to refresh it (daily rotation: HMAC already verified for today)
            const raw = cookieStore.get(VISITOR_COOKIE_NAME)?.value;
            if (raw) {
                // Cookie is already valid for today — re-set to ensure maxAge is refreshed
                const refreshed = await signVisitorCookie(uuid);
                const opts = visitorCookieOptions();
                response.cookies.set(VISITOR_COOKIE_NAME, refreshed, opts);
            }
        }

        return response;
    } catch (err) {
        rollbackVisitorReaction(visitorIdHash);
        rollbackIpReaction(ip);
        console.error('Reaction toggle failed:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }
}
