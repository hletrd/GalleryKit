import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions/auth';
import { localizePath } from '@/lib/locale-path';

export default async function ProtectedLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    if (!(await isAdmin())) {
        redirect(localizePath(locale, '/admin'));
    }

    return <>{children}</>;
}
