'use client';

import Link from "next/link";
import { useTranslation } from "@/components/i18n-provider";

interface TopicEmptyStateProps {
    hasFilters: boolean;
    clearHref: string;
}

export function TopicEmptyState({ hasFilters, clearHref }: TopicEmptyStateProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-xl text-muted-foreground gap-2">
            <p>{t('home.noImages')}</p>
            {hasFilters && (
                <Link href={clearHref} className="underline hover:text-primary">
                    {t('home.clearFilter')}
                </Link>
            )}
        </div>
    );
}
