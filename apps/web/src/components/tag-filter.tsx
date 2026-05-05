'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { useTranslation } from "@/components/i18n-provider";
import { humanizeTagLabel } from "@/lib/photo-title";

export function TagFilter({ tags }: { tags: { id: number, name: string, slug: string, count: number }[] }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentTagsParam = searchParams.get('tags');
    const currentTags = currentTagsParam ? currentTagsParam.split(',').filter(Boolean) : [];
    const { t } = useTranslation();

    const handleTagClick = (slug: string | null) => {
        const params = new URLSearchParams(searchParams.toString());

        if (!slug) {
            // Clear all tags
            params.delete('tags');
        } else if (currentTags.includes(slug)) {
            // Remove this tag
            const newTags = currentTags.filter(t => t !== slug);
            if (newTags.length === 0) {
                params.delete('tags');
            } else {
                params.set('tags', newTags.join(','));
            }
        } else {
            // Add this tag
            const newTags = [...currentTags, slug];
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

    // Interactive pills must clear the 44x44 touch-target floor recommended
    // by WCAG 2.5.5 AAA / Apple HIG / Google MDN. WCAG 2.5.8 AA only requires
    // 24x24, but real-world thumb targets need 44 px to avoid mis-taps. The
    // base Badge already applies `px-2 py-0.5`; we override with a wider
    // padding plus an explicit min-height so the tappable region is
    // unambiguous. (F-1, supersedes AGG3R-03 / C3R-RPL-03)
    const interactivePillClass = "cursor-pointer hover:bg-primary/90 min-h-[44px] px-3 py-1";

    // F-5 / AGG1L-LOW-01: tag slugs canonically use `_` to separate
    // words; render those as spaces via the shared `humanizeTagLabel`
    // utility so all consumers (visible UI, alt text, JSON-LD `name`)
    // produce the same humanized output.
    const displayName = humanizeTagLabel;

    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('home.tagFilter')}>
            <Badge
                asChild
                variant={currentTags.length === 0 ? "default" : "outline"}
                className={cn(interactivePillClass, currentTags.length === 0 && "bg-primary text-primary-foreground")}
            >
                <button
                    type="button"
                    onClick={() => handleTagClick(null)}
                    onKeyDown={handleKeyDown(null)}
                    aria-pressed={currentTags.length === 0}
                >
                    {t('home.allTags')}
                </button>
            </Badge>
            {tags.map(tag => (
                <Badge
                    key={tag.id}
                    asChild
                    variant={currentTags.includes(tag.slug) ? "default" : "outline"}
                    className={cn(
                        interactivePillClass,
                        "flex gap-1",
                        currentTags.includes(tag.slug) && "bg-primary text-primary-foreground"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => handleTagClick(tag.slug)}
                        onKeyDown={handleKeyDown(tag.slug)}
                        aria-pressed={currentTags.includes(tag.slug)}
                    >
                        {displayName(tag.name)}
                        <span className="opacity-60 text-[10px]">({tag.count})</span>
                    </button>
                </Badge>
            ))}
        </div>
    );
}
