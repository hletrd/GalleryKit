import { notFound } from 'next/navigation';
import { getImageCached } from '@/lib/data';
import { parseSafePositiveInteger } from '@/lib/validation';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

/**
 * C2-04 (UX-03, run-10 c2) — status-bearing existence check.
 *
 * This segment's own `loading.tsx` (the deliberate lightbox-transition
 * skeleton) makes the page a streamed 200, so the page body's `notFound()`
 * cannot set the HTTP status (vercel/next.js#75543). The layout renders
 * OUTSIDE that boundary: the malformed-id and missing-image decisions here
 * resolve before streaming starts, producing a real 404 while keeping the
 * skeleton for real photos. `getImageCached` is React-cache()-deduped with
 * generateMetadata and the page, so this adds no extra DB round-trip.
 *
 * During restore maintenance the DB is not authoritative — skip the check
 * and let the page render its maintenance panel.
 */
export default async function PhotoLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ id: string }>;
}) {
    if (!isRestoreMaintenanceActive()) {
        const { id } = await params;
        const imageId = parseSafePositiveInteger(id);
        if (imageId === null) notFound();
        const image = await getImageCached(imageId);
        if (!image) notFound();
    }
    return children;
}
