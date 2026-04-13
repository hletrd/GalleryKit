'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/components/i18n-provider";

export function AdminNav() {
    const pathname = usePathname();
    const { t } = useTranslation();

    const links = [
        { href: '/admin/dashboard', label: t('nav.dashboard') },
        { href: '/admin/categories', label: t('nav.categories') },
        { href: '/admin/tags', label: t('nav.tags') },
        { href: '/admin/password', label: t('nav.password') },
        { href: '/admin/users', label: t('nav.users') },
        { href: '/admin/db', label: t('nav.db') },
    ];

    return (
        <nav className="flex items-center flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {links.map(({ href, label }) => {
                const isActive = pathname === href;
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
