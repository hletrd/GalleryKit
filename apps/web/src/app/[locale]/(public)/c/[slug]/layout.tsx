import { notFound } from 'next/navigation';
import { getSmartCollectionBySlugCached } from '@/lib/data';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

/**
 * C2-04 (UX-03, run-10 c2) — status-bearing existence check.
 *
 * See `[topic]/layout.tsx` for the streaming mechanism: only a segment
 * layout resolves before the 200 shell flushes, so this is where a missing
 * or private smart collection becomes a real HTTP 404 (the page body 404s
 * private collections identically, so no information is leaked either way).
 * The cached lookup is deduped with generateMetadata and the page.
 *
 * During restore maintenance the DB is not authoritative — skip the check
 * and let the page render its maintenance panel.
 */
export default async function SmartCollectionLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ slug: string }>;
}) {
    if (!isRestoreMaintenanceActive()) {
        const { slug } = await params;
        const collection = await getSmartCollectionBySlugCached(slug);
        if (!collection || !collection.is_public) notFound();
    }
    return children;
}
