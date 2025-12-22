import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions';
import { AdminHeader } from '@/components/admin-header';

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    if (!(await isAdmin())) {
        redirect('/admin');
    }

    return (
        <div className="flex flex-col min-h-screen">
            <AdminHeader />
            <main className="flex-1 w-full py-6 px-4">
                {children}
            </main>
        </div>
    );
}
