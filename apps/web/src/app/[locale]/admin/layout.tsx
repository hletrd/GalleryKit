import { AdminHeader } from '@/components/admin-header';
import { getCurrentUser } from '@/app/actions/auth';
import { getTranslations } from 'next-intl/server';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const t = await getTranslations('common');
    // C1R-03: only render the protected admin chrome (nav + logout) for
    // authenticated admins. The unauthenticated login page should not
    // enumerate admin sub-routes or render a logout form. `getCurrentUser`
    // is React cache()-wrapped so this does not duplicate DB work for the
    // protected sub-layout.
    const currentUser = await getCurrentUser();

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <a href="#admin-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
                {t('skipToContent')}
            </a>
            {currentUser ? <AdminHeader /> : null}
            <main id="admin-content" className="flex-1 w-full py-6 px-4 overflow-auto">
                {children}
            </main>
        </div>
    );
}
