import { AdminHeader } from '@/components/admin-header';
import { getCurrentUser } from '@/app/actions/auth';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // C1R-03: only render the protected admin chrome (nav + logout) for
    // authenticated admins. The unauthenticated login page should not
    // enumerate admin sub-routes or render a logout form. `getCurrentUser`
    // is React cache()-wrapped so this does not duplicate DB work for the
    // protected sub-layout.
    let currentUser = null;
    try {
        currentUser = await getCurrentUser();
    } catch (err) {
        console.error('Admin layout: failed to resolve current user', err);
    }

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            {currentUser ? <AdminHeader /> : null}
            {/* AGG-R5C3-03 (WCAG 2.4.1): the single global skip link in
                [locale]/layout.tsx targets #main-content. The admin <main>
                MUST carry that id so the global skip link resolves on admin
                routes too — previously it carried only #admin-content, leaving
                the global "Skip to content" link pointing at nothing on every
                admin page. The admin layout therefore renders NO separate skip
                link (the global one is the single source of truth). */}
            <main id="main-content" tabIndex={-1} className="flex-1 w-full py-6 px-4 overflow-auto focus:outline-none">
                {children}
            </main>
        </div>
    );
}
