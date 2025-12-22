import { getAdminUsers } from "@/app/actions";
import { AdminUserManager } from "@/components/admin-user-manager";
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
    const adminUsers = await getAdminUsers();
    const t = await getTranslations('users');

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold">{t('title')}</h1>
            <AdminUserManager users={adminUsers} />
        </div>
    );
}
