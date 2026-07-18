'use client';

import Image from "next/image";
import Link from "next/link";
import { ChevronUp, ChevronDown, Sun, Moon, Monitor, Circle } from "lucide-react";
import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useTheme } from "next-themes";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTranslation } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/constants";
import siteConfig from "@/site-config.json";
import { Search } from "@/components/search";
import { localizePath, stripLocalePrefix } from "@/lib/locale-path";
import { nextTheme, type StoredTheme } from "@/lib/theme";

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
    en: 'English',
    ko: '한국어',
};

interface NavClientProps {
    topics: { slug: string; label: string; image_filename?: string | null }[];
    navTitle: string;
    imageSizes: number[];
    semanticSearchMode?: string;
    showTimelineNav?: boolean;
    showMapNav?: boolean;
}

const MD_BREAKPOINT = 768;

export function NavClient({ topics, navTitle, imageSizes, semanticSearchMode = 'disabled', showTimelineNav = true, showMapNav = true }: NavClientProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const locale = useLocale();
    const router = useRouter();
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);
    const [mounted, setMounted] = useState(false);
    const topicsPanelRef = useRef<HTMLDivElement>(null);
    const menuToggleRef = useRef<HTMLButtonElement>(null);
    const keyboardExpansionPendingRef = useRef(false);
    const currentTheme = (mounted ? (theme ?? 'system') : 'system') as StoredTheme;
    const nextThemeValue = nextTheme(currentTheme);
    const browseLinks = [
        ...(showTimelineNav ? [{ href: localizePath(locale, '/timeline'), label: t('footer.timeline') }] : []),
        ...(showMapNav ? [{ href: localizePath(locale, '/map'), label: t('footer.map') }] : []),
    ];
    const hasExpandableMobileContent = topics.length > 0 || browseLinks.length > 0;
    const themeAriaLabel = t('aria.cycleTheme', {
        theme: t(`theme.${currentTheme}`),
        nextTheme: t(`theme.${nextThemeValue}`),
    });

    // Auto-collapse when viewport crosses into desktop
    useEffect(() => {
        const frame = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    // Auto-collapse when viewport crosses into desktop
    useEffect(() => {
        const mql = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`);
        const handler = (e: MediaQueryListEvent) => {
            if (e.matches) setIsExpanded(false);
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setIsExpanded(false));
        return () => cancelAnimationFrame(frame);
    }, [pathname]);

    useEffect(() => {
        if (!isExpanded || !keyboardExpansionPendingRef.current) return;
        keyboardExpansionPendingRef.current = false;
        const frame = requestAnimationFrame(() => {
            topicsPanelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [isExpanded]);

    const otherLocale = LOCALES.find((supportedLocale) => supportedLocale !== locale) ?? DEFAULT_LOCALE;
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
        router.push(localeSwitchHref, { scroll: false });
    }, [otherLocale, localeSwitchHref, router]);

    const handleMenuToggle = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
        const willExpand = !isExpanded;
        keyboardExpansionPendingRef.current = willExpand && event.detail === 0;
        setIsExpanded(willExpand);
    }, [isExpanded]);

    const handleNavKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Escape' || !isExpanded) return;
        event.preventDefault();
        setIsExpanded(false);
        menuToggleRef.current?.focus();
    }, [isExpanded]);

    return (
        <nav aria-label={t('aria.mainNav')} onKeyDown={handleNavKeyDown} className="sticky top-0 z-50 w-full bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 transition-all duration-300">
            <div className={cn(
                "container mx-auto flex items-center px-4 transition-all duration-300",
                isExpanded
                    ? "h-auto py-3 flex-wrap items-start"
                    : "h-16 overflow-hidden md:h-auto md:min-h-16 md:overflow-visible md:flex-wrap md:py-2 md:items-start"
            )}>
                {/* Title */}
                <div className={cn("flex items-center mr-3 md:mr-6 gap-4 min-w-0 shrink", isExpanded && "pt-1")}>
                    <Link href={localizedHomeHref} className="flex items-center space-x-2 min-w-0 min-h-[44px] rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <span className="font-bold text-xl tracking-tight truncate">{navTitle}</span>
                    </Link>
                </div>

                {/* Topics */}
                <div ref={topicsPanelRef} id="primary-nav-topics" className={cn(
                    "flex items-center gap-2 text-sm font-medium min-w-0 transition-all duration-300",
                    isExpanded
                        ? "flex-wrap content-start w-full mt-1"
                        : "hidden",
                    "md:flex md:flex-1 md:ml-auto md:justify-end md:mask-none md:overflow-visible md:flex-wrap md:w-auto md:mt-0"
                )}>
                    {browseLinks.map((link) => {
                        const isActive = stripLocalePrefix(pathname) === stripLocalePrefix(link.href);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "transition-all duration-200 flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full whitespace-nowrap shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                    isActive
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                <span>{link.label}</span>
                            </Link>
                        );
                    })}
                    {topics.map((topic) => {
                        const href = localizePath(locale, `/${topic.slug}`);
                        const isActive = stripLocalePrefix(pathname) === `/${topic.slug}`;
                        return (
                            <Link
                                key={topic.slug}
                                href={href}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "transition-all duration-200 flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full whitespace-nowrap shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                    isActive
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {topic.image_filename && (
                                    <Image
                                        src={`/resources/${topic.image_filename}`}
                                        alt=""
                                        aria-hidden="true"
                                        width={24}
                                        height={24}
                                        className="w-6 h-6 object-cover rounded-full"
                                    />
                                )}
                                <span>{topic.label}</span>
                            </Link>
                        );
                    })}
                </div>

                {/* Controls: visible in the collapsed mobile bar; topic chips move into the expanded mobile panel. */}
                <div id="primary-nav-controls" className={cn(
                    "items-center gap-1 shrink-0",
                    isExpanded ? "flex w-full mt-2" : "flex ml-auto"
                )}>
                    <Search previewImageSizes={imageSizes} semanticSearchMode={semanticSearchMode} showDesktopLabel />
                    <button
                        onClick={() => setTheme(nextThemeValue)}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={themeAriaLabel}
                        title={themeAriaLabel}
                    >
                        {(currentTheme === 'light') && <Sun className="h-4 w-4" />}
                        {(currentTheme === 'dark') && <Moon className="h-4 w-4" />}
                        {(currentTheme === 'oled') && <Circle className="h-4 w-4 fill-current" />}
                        {(currentTheme === 'system') && <Monitor className="h-4 w-4" />}
                    </button>
                    <button
                        onClick={handleLocaleSwitch}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={t('aria.switchLocale', { language: LOCALE_DISPLAY_NAMES[otherLocale] ?? otherLocale })}
                    >
                        {otherLocale.toUpperCase()}
                    </button>
                </div>

                {/* Mobile Expand Toggle. Sized to the 44x44 touch-target
                    minimum (Apple HIG / Google MDN). Rendered after the
                    collapsed controls so DOM focus order matches the visual
                    order: search, theme, language, then menu. */}
                {hasExpandableMobileContent && (
                    <button
                        ref={menuToggleRef}
                        onClick={handleMenuToggle}
                        className={cn(
                            "min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full md:hidden shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isExpanded ? "ml-auto mt-2" : "ml-1"
                        )}
                        aria-label={isExpanded ? t('aria.collapseMenu') : t('aria.expandMenu')}
                        aria-expanded={isExpanded}
                        aria-controls="primary-nav-topics primary-nav-controls"
                    >
                        {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                        ) : (
                            <ChevronDown className="h-4 w-4" />
                        )}
                    </button>
                )}
            </div>
        </nav>
    );
}
