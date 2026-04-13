'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/components/i18n-provider";
import { useLocale } from "next-intl";

export function AdminNav() {
    const pathname = usePathname();
    const { t } = useTranslation();
    const locale = useLocale();

    const links = [
        { href: `/${locale}/admin/dashboard`, label: t('nav.dashboard') },
        { href: `/${locale}/admin/categories`, label: t('nav.categories') },
        { href: `/${locale}/admin/tags`, label: t('nav.tags') },
        { href: `/${locale}/admin/password`, label: t('nav.password') },
        { href: `/${locale}/admin/users`, label: t('nav.users') },
        { href: `/${locale}/admin/db`, label: t('nav.db') },
    ];

    return (
        <nav aria-label={t('aria.adminNav')} className="flex items-center flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {links.map(({ href, label }) => {
                const isActive = pathname === href || pathname === href.replace(`/${locale}`, '');
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
