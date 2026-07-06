import { notFound } from 'next/navigation';
import { getTopicBySlugCached } from '@/lib/data';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

/**
 * C2-04 (UX-03, run-10 c2) — status-bearing existence check.
 *
 * Next.js streams a 200 shell the moment any ancestor `loading.tsx` boundary
 * renders; `notFound()` thrown later (page body OR generateMetadata — see
 * vercel/next.js#75543) can only swap the UI, never the HTTP status. A
 * segment LAYOUT renders outside its own segment's loading boundary, so the
 * existence check here resolves before streaming starts and yields a real
 * 404. `getTopicBySlugCached` is React-cache()-deduped with the page's own
 * lookup (no extra query), and it resolves aliases to their canonical topic,
 * so alias slugs stay truthy here and keep their in-page redirect.
 *
 * During restore maintenance the DB is not authoritative — skip the check
 * and let the page render its maintenance panel (200, matching all public
 * pages during a restore window).
 */
export default async function TopicLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ topic: string }>;
}) {
    if (!isRestoreMaintenanceActive()) {
        const { topic } = await params;
        const topicData = await getTopicBySlugCached(topic);
        if (!topicData) notFound();
    }
    return children;
}
