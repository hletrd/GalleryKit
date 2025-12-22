
import { getAdminUsers } from "@/app/actions";
import { AdminUserManager } from "@/components/admin-user-manager";

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
    const adminUsers = await getAdminUsers();

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold">User Management</h1>
            <AdminUserManager users={adminUsers} />
        </div>
    );
}
