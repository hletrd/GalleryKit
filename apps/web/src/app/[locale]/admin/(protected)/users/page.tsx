import { getAdminUsers } from "@/app/actions";
import { AdminUserManager } from "@/components/admin-user-manager";
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { adminRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('users');

export default async function AdminUsersPage() {
    const adminUsers = await getAdminUsers();
    const t = await getTranslations('users');

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <Card>
                <CardHeader>
                    <CardDescription>{t('adminUsers')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <AdminUserManager users={adminUsers} />
                </CardContent>
            </Card>
        </div>
    );
}
