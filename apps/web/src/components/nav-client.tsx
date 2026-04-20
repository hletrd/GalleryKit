'use client';

import Image from "next/image";
import Link from "next/link";
import { ChevronUp, ChevronDown, Sun, Moon } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTranslation } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { DEFAULT_LOCALE } from "@/lib/constants";
import siteConfig from "@/site-config.json";
import { Search } from "@/components/search";
import { localizePath, stripLocalePrefix } from "@/lib/locale-path";

interface NavClientProps {
    topics: { slug: string; label: string; image_filename?: string | null }[];
    navTitle: string;
}

const MD_BREAKPOINT = 768;

export function NavClient({ topics, navTitle }: NavClientProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const locale = useLocale();
    const router = useRouter();
    const { t } = useTranslation();
    const { resolvedTheme, setTheme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);

    // Auto-collapse when viewport crosses into desktop
    useEffect(() => {
        const mql = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`);
        const handler = (e: MediaQueryListEvent) => {
            if (e.matches) setIsExpanded(false);
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    const otherLocale = locale === 'en' ? 'ko' : 'en';
    const localizedHomeHref = siteConfig.home_link.startsWith('http')
        ? siteConfig.home_link
        : localizePath(locale, siteConfig.home_link);
    // Swap locale prefix in the current path, preserving query params
    const localeSwitchHref = (() => {
        const path = stripLocalePrefix(pathname);
        const targetPath = otherLocale === DEFAULT_LOCALE
            ? localizePath(DEFAULT_LOCALE, path)
            : localizePath(otherLocale, path);
        // Preserve search params (e.g., ?tags=landscape) via useSearchParams (SSR-safe)
        const search = searchParams.toString();
        return search ? `${targetPath}?${search}` : targetPath;
    })();

    const handleLocaleSwitch = useCallback(() => {
        document.cookie = `NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=${60 * 60 * 24 * 365}${window.location.protocol === 'https:' ? ';Secure' : ''}`;
        router.push(localeSwitchHref);
    }, [otherLocale, localeSwitchHref, router]);

    return (
        <nav aria-label={t('aria.mainNav')} className="sticky top-0 z-50 w-full bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 transition-all duration-300">
            <div className={cn(
                "container mx-auto flex items-center px-4 transition-all duration-300",
                isExpanded ? "h-auto py-3 flex-wrap items-start" : "h-16 overflow-hidden"
            )}>
                {/* Title */}
                <div className={cn("flex items-center mr-6 gap-4 shrink-0", isExpanded && "pt-1")}>
                    <Link href={localizedHomeHref} className="flex items-center space-x-2 shrink-0">
                        <span className="font-bold text-xl tracking-tight">{navTitle}</span>
                    </Link>
                </div>

                {/* Mobile Expand Toggle */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn(
                        "ml-auto p-2 hover:bg-accent rounded-full md:hidden shrink-0",
                        isExpanded && "mt-1"
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

                {/* Topics */}
                <div className={cn(
                    "flex items-center gap-2 text-sm font-medium min-w-0 transition-all duration-300",
                    isExpanded
                        ? "flex-wrap content-start w-full mt-1"
                        : "flex-1 overflow-x-auto scrollbar-hide mask-gradient-right pr-4",
                    "md:flex-1 md:ml-auto md:justify-end md:mask-none md:overflow-visible md:flex-wrap md:w-auto md:mt-0"
                )}>
                    {topics.map((topic) => {
                        const href = localizePath(locale, `/${topic.slug}`);
                        const isActive = stripLocalePrefix(pathname) === `/${topic.slug}`;
                        return (
                            <Link
                                key={topic.slug}
                                href={href}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "transition-all duration-200 flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0",
                                    isActive
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {topic.image_filename ? (
                                    <Image
                                        src={`/resources/${topic.image_filename}`}
                                        alt={topic.label}
                                        title={topic.label}
                                        width={24}
                                        height={24}
                                        className="w-6 h-6 object-cover rounded-full"
                                    />
                                ) : (
                                    topic.label
                                )}
                            </Link>
                        );
                    })}
                </div>

                {/* Controls: hidden on mobile when collapsed, shown when expanded; always rightmost on desktop */}
                <div className={cn(
                    "items-center gap-1 shrink-0",
                    isExpanded ? "flex w-full mt-2" : "hidden md:flex"
                )}>
                    <Search />
                    <button
                        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full transition-colors"
                        aria-label={t('aria.toggleTheme')}
                    >
                        <Sun className="h-4 w-4 hidden dark:block" />
                        <Moon className="h-4 w-4 block dark:hidden" />
                    </button>
                    <button
                        onClick={handleLocaleSwitch}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
                    >
                        {otherLocale.toUpperCase()}
                    </button>
                </div>
            </div>
        </nav>
    );
}
