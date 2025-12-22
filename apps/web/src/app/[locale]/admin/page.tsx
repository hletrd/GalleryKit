import { redirect } from 'next/navigation';
import { isAdmin } from '@/app/actions';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    // If already logged in, redirect to dashboard
    if (await isAdmin()) {
        redirect('/admin/dashboard');
    }

    return <LoginForm />;
}
