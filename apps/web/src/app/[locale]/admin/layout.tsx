import { AdminHeader } from '@/components/admin-header';
import { getTranslations } from 'next-intl/server';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const t = await getTranslations('common');

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <a href="#admin-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
                {t('skipToContent')}
            </a>
            <AdminHeader />
            <main id="admin-content" className="flex-1 w-full py-6 px-4 overflow-auto">
                {children}
            </main>
        </div>
    );
}
