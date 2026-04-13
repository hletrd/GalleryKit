'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AdminNav } from '@/components/admin-nav';
import { logout } from '@/app/actions';
import { useTranslation } from '@/components/i18n-provider';

export function AdminHeader() {
    const { t, locale } = useTranslation();

    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-14 items-center px-4">
                <div className="mr-4 flex">
                    <Link className="mr-6 flex items-center space-x-2 font-bold" href={`/${locale}/admin/dashboard`}>
                        <span>{t('nav.admin')}</span>
                    </Link>
                    <AdminNav />
                </div>
                <div className="ml-auto flex items-center space-x-4">
                    <form action={logout}>
                        <input type="hidden" name="locale" value={locale} />
                        <Button variant="ghost" size="sm">{t('nav.logout')}</Button>
                    </form>
                </div>
            </div>
        </header>
    );
}
