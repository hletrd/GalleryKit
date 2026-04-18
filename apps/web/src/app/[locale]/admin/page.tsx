import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions';
import { LoginForm } from './login-form';
import { localizePath } from '@/lib/locale-path';

export const dynamic = 'force-dynamic';

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    // If already logged in, redirect to dashboard
    if (await isAdmin()) {
        redirect(localizePath(locale, '/admin/dashboard'));
    }

    return <LoginForm />;
}
