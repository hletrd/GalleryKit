'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { useTranslation } from "@/components/i18n-provider";
import { humanizeTagLabel } from "@/lib/photo-title";

export function TagFilter({
    tags,
    currentTags = [],
}: {
    tags: { id: number, name: string, slug: string, count: number }[];
    currentTags?: string[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { t } = useTranslation();
    const canonicalTags = currentTags.map(tag => tag.trim()).filter(Boolean);

    const handleTagClick = (slug: string | null) => {
        const params = new URLSearchParams(searchParams.toString());

        if (!slug) {
            // Clear all tags
            params.delete('tags');
        } else if (canonicalTags.includes(slug)) {
            // Remove this tag
            const newTags = canonicalTags.filter(t => t !== slug);
            if (newTags.length === 0) {
                params.delete('tags');
            } else {
                params.set('tags', newTags.join(','));
            }
        } else {
            // Add this tag
            const newTags = [...canonicalTags, slug];
            params.set('tags', newTags.join(','));
        }

        const queryString = params.toString();
        router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
    };

    if (tags.length === 0) return null;

    const handleKeyDown = (slug: string | null) => (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTagClick(slug);
        }
    };

    // F-5 / AGG1L-LOW-01: tag slugs canonically use `_` to separate
    // words; render those as spaces via the shared `humanizeTagLabel`
    // utility so all consumers (visible UI, alt text, JSON-LD `name`)
    // produce the same humanized output.
    const displayName = humanizeTagLabel;

    const chips = (
        <>
            <Badge
                asChild
                variant={canonicalTags.length === 0 ? "default" : "outline"}
                // DES-R4C15-03: min-h-11 (44 px) per the blocking touch-target
                // policy — these chips are real <button>s on the mobile-priority
                // home surface. Matches the nav topic pills' min-h-[44px].
                className={cn("cursor-pointer hover:bg-primary/90 min-h-11 min-w-11 justify-center px-3 py-1", canonicalTags.length === 0 && "bg-primary text-primary-foreground")}
            >
                <button
                    type="button"
                    onClick={() => handleTagClick(null)}
                    onKeyDown={handleKeyDown(null)}
                    aria-pressed={canonicalTags.length === 0}
                >
                    {t('home.allTags')}
                </button>
            </Badge>
            {tags.map(tag => (
                <Badge
                    key={tag.id}
                    asChild
                    variant={canonicalTags.includes(tag.slug) ? "default" : "outline"}
                    className={cn(
                        // DES-R4C15-03: 44 px floor (see "All" chip above).
                        "cursor-pointer hover:bg-primary/90 min-h-11 min-w-11 justify-center px-3 py-1",
                        "flex gap-1",
                        canonicalTags.includes(tag.slug) && "bg-primary text-primary-foreground"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => handleTagClick(tag.slug)}
                        onKeyDown={handleKeyDown(tag.slug)}
                        aria-pressed={canonicalTags.includes(tag.slug)}
                    >
                        {displayName(tag.name)}
                        {/* AGG-R8-04 (run-8 c2): the count must inherit the chip
                            foreground when the chip is ACTIVE. On the active
                            chip (bg-primary), an unconditional text-muted-
                            foreground computed 2.94:1 (light) / 2.45:1 (dark) —
                            below WCAG 1.4.3 4.5:1 small-text — on the public home
                            page. Gate the muted class on the INACTIVE state so
                            an active chip's count uses text-primary-foreground
                            (the chip's designed ≥4.5:1 pairing); inactive chips
                            keep the muted 6.03:1 look. */}
                        <span
                            className={cn(
                                "text-xs",
                                canonicalTags.includes(tag.slug)
                                    ? "text-primary-foreground/90"
                                    : "text-muted-foreground"
                            )}
                        >
                            ({tag.count})
                        </span>
                    </button>
                </Badge>
            ))}
        </>
    );

    return (
        <div className="w-full sm:w-auto">
            <details className="group sm:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border bg-background px-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                    <span>{t('home.tagFilter')}</span>
                    {canonicalTags.length > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                            {canonicalTags.length}
                        </span>
                    )}
                </summary>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('home.tagFilter')}>
                    {chips}
                </div>
            </details>
            <div className="hidden flex-wrap gap-2 sm:flex" role="group" aria-label={t('home.tagFilter')}>
                {chips}
            </div>
        </div>
    );
}
