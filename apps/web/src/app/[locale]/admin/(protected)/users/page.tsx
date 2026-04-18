import { getAdminUsers } from "@/app/actions";
import { AdminUserManager } from "@/components/admin-user-manager";
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
    const adminUsers = await getAdminUsers();
    const t = await getTranslations('users');

    return (
        <div className="max-w-4xl">
            <Card>
                <CardHeader>
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>{t('adminUsers')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <AdminUserManager users={adminUsers} />
                </CardContent>
            </Card>
        </div>
    );
}
