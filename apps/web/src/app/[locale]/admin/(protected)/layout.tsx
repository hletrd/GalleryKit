import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions';
import { AdminHeader } from '@/components/admin-header';
import { getTranslations } from 'next-intl/server';

export default async function ProtectedLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    if (!(await isAdmin())) {
        redirect(`/${locale}/admin`);
    }

    const t = await getTranslations('common');

    return (
        <div className="flex flex-col min-h-screen">
            <a href="#admin-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
                {t('skipToContent')}
            </a>
            <AdminHeader />
            <main id="admin-content" className="flex-1 w-full py-6 px-4">
                {children}
            </main>
        </div>
    );
}
