'use client';

import Link from "next/link";
import { ChevronUp, ChevronDown, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";

import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useTranslation } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import siteConfig from "@/site-config.json";
import { Search } from "@/components/search";

interface NavClientProps {
    topics: { slug: string; label: string; image_filename?: string | null }[];
}

export function NavClient({ topics }: NavClientProps) {
    const pathname = usePathname();
    const locale = useLocale();
    const { t } = useTranslation();
    const { resolvedTheme, setTheme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);

    const otherLocale = locale === 'en' ? 'ko' : 'en';
    // Swap locale prefix in the current path, preserving query params
    const localeSwitchHref = (() => {
        const localePrefix = `/${locale}`;
        let path: string;
        if (pathname.startsWith(localePrefix + '/') || pathname === localePrefix) {
            path = `/${otherLocale}${pathname.slice(localePrefix.length) || '/'}`;
        } else {
            path = `/${otherLocale}${pathname}`;
        }
        // Preserve search params (e.g., ?tags=landscape)
        const search = typeof window !== 'undefined' ? window.location.search : '';
        return search ? `${path}${search}` : path;
    })();

    return (
        <nav className="sticky top-0 z-50 w-full bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 transition-all duration-300">
            <div className={cn(
                "container mx-auto flex items-center px-4 overflow-hidden transition-all duration-300",
                isExpanded ? "h-auto py-4 items-start" : "h-16"
            )}>
                <div className={cn("flex items-center mr-6 gap-4 shrink-0", isExpanded && "pt-1.5")}>
                    <Link href={siteConfig.home_link} className="flex items-center space-x-2 shrink-0">
                        <span className="font-bold text-xl tracking-tight">{siteConfig.nav_title}</span>
                    </Link>
                </div>

                <div className={cn(
                    "flex items-center gap-2 text-sm font-medium flex-1 min-w-0 transition-all duration-300",
                    // Mobile: Expanded vs Collapsed
                    isExpanded
                        ? "flex-wrap content-start"
                        : "overflow-x-auto scrollbar-hide mask-gradient-right pr-4",
                    // Desktop: Always right aligned, no mask if not overflowing (handled by padding/layout visually)
                    "md:ml-auto md:justify-end md:mask-none md:overflow-visible md:flex-wrap"
                )}>
                    {topics.map((topic) => {
                        const isActive = pathname === `/${topic.slug}`;
                        return (
                            <Link
                                key={topic.slug}
                                href={`/${topic.slug}`}
                                className={cn(
                                    "transition-all duration-200 flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0",
                                    isActive
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {topic.image_filename ? (
                                    <img
                                        src={`/resources/${topic.image_filename}`}
                                        alt={topic.label}
                                        title={topic.label}
                                        className="w-6 h-6 object-cover rounded-full"
                                    />
                                ) : (
                                    topic.label
                                )}
                            </Link>
                        );
                    })}
                </div>

                <div className={cn("flex items-center gap-1 shrink-0", isExpanded && "pt-1")}>
                    <Search />
                    <button
                        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full transition-colors"
                        aria-label={t('aria.toggleTheme')}
                    >
                        <Sun className="h-4 w-4 hidden dark:block" />
                        <Moon className="h-4 w-4 block dark:hidden" />
                    </button>
                    <Link
                        href={localeSwitchHref}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
                    >
                        {otherLocale.toUpperCase()}
                    </Link>
                </div>

                {/* Mobile Expand Toggle */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn(
                        "ml-2 p-2 hover:bg-accent rounded-full md:hidden shrink-0",
                        isExpanded && "mt-1.5"
                    )}
                    aria-label={isExpanded ? t('aria.collapseMenu') : t('aria.expandMenu')}
                    aria-expanded={isExpanded}
                >
                    {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                    ) : (
                        <ChevronDown className="h-4 w-4" />
                    )}
                </button>
            </div>
        </nav>
    );
}
