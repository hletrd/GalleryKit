'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/components/i18n-provider";
import { useLocale } from "next-intl";
import { localizePath, stripLocalePrefix } from "@/lib/locale-path";

export function AdminNav() {
    const pathname = usePathname();
    const { t } = useTranslation();
    const locale = useLocale();

    const links = [
        { href: localizePath(locale, '/admin/dashboard'), label: t('nav.dashboard') },
        { href: localizePath(locale, '/admin/categories'), label: t('nav.categories') },
        { href: localizePath(locale, '/admin/tags'), label: t('nav.tags') },
        { href: localizePath(locale, '/admin/seo'), label: t('nav.seo') },
        { href: localizePath(locale, '/admin/settings'), label: t('nav.settings') },
        { href: localizePath(locale, '/admin/password'), label: t('nav.password') },
        { href: localizePath(locale, '/admin/users'), label: t('nav.users') },
        { href: localizePath(locale, '/admin/db'), label: t('nav.db') },
    ];

    return (
        <nav aria-label={t('aria.adminNav')} className="flex items-center flex-nowrap gap-x-6 text-sm font-medium overflow-x-auto scrollbar-hide">
            {links.map(({ href, label }) => {
                const isActive = stripLocalePrefix(pathname) === stripLocalePrefix(href);
                return (
                    <Link
                        key={href}
                        href={href}
                        className={cn(
                            "transition-colors hover:text-foreground/80",
                            isActive ? "text-foreground font-bold" : "text-foreground/60"
                        )}
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
