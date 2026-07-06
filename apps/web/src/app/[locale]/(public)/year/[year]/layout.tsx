import { notFound } from 'next/navigation';

/**
 * C2-04 (UX-03, run-10 c2) — status-bearing validity check.
 *
 * See `[topic]/layout.tsx` for the streaming mechanism: only a segment
 * layout resolves before the 200 shell flushes. Year validity is pure
 * arithmetic (no DB), so this runs unconditionally — an invalid year is a
 * real HTTP 404 even during restore maintenance.
 */
export default async function YearLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ year: string }>;
}) {
    const { year } = await params;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 9999) {
        notFound();
    }
    return children;
}
