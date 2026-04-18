import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions';

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

    return <>{children}</>;
}
