'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { useTranslation } from "@/components/i18n-provider";

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
        router.refresh();
    };

    if (tags.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2">
             <Badge
                variant={currentTags.length === 0 ? "default" : "outline"}
                className={cn("cursor-pointer hover:bg-primary/90", currentTags.length === 0 && "bg-primary text-primary-foreground")}
                onClick={() => handleTagClick(null)}
            >
                {t('home.allTags')}
            </Badge>
            {tags.map(tag => (
                <Badge
                    key={tag.id}
                    variant={currentTags.includes(tag.slug) ? "default" : "outline"}
                    className={cn(
                        "cursor-pointer hover:bg-primary/90 flex gap-1",
                        currentTags.includes(tag.slug) && "bg-primary text-primary-foreground"
                    )}
                    onClick={() => handleTagClick(tag.slug)}
                >
                    {tag.name}
                    <span className="opacity-60 text-[10px]">({tag.count})</span>
                </Badge>
            ))}
        </div>
    );
}
