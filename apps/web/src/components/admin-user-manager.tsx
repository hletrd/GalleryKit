'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { createAdminUser, deleteAdminUser } from "@/app/actions";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";

interface AdminUser {
    id: number;
    username: string;
    created_at: Date | null;
}

interface AdminUserManagerProps {
    users: AdminUser[];
}

export function AdminUserManager({ users }: AdminUserManagerProps) {
    const [isCreating, setIsCreating] = useState(false);
    const [open, setOpen] = useState(false);

    async function handleCreate(formData: FormData) {
        setIsCreating(true);
        const result = await createAdminUser(formData);
        setIsCreating(false);

        if (result.error) {
            toast.error(result.error);
        } else {
            toast.success('User created successfully');
            setOpen(false);
        }
    }

    async function handleDelete(id: number, username: string) {
        if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

        const result = await deleteAdminUser(id);
        if (result.error) {
            toast.error(result.error);
        } else {
            toast.success('User deleted successfully');
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Admin Users</CardTitle>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm">
                            <UserPlus className="mr-2 h-4 w-4" />
                            Add User
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add New Admin User</DialogTitle>
                            <DialogDescription>
                                Create a new user with access to the admin dashboard.
                            </DialogDescription>
                        </DialogHeader>
                        <form action={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Username</label>
                                <Input name="username" placeholder="Username" required minLength={3} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Password</label>
                                <Input name="password" type="password" placeholder="Password (min 8 chars)" required minLength={8} />
                            </div>
                            <DialogFooter>
                                <Button type="submit" disabled={isCreating}>
                                    {isCreating ? 'Creating...' : 'Create User'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Username</TableHead>
                                <TableHead>Created At</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        {user.username}
                                    </TableCell>
                                    <TableCell>
                                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDelete(user.id, user.username)}
                                            className="text-destructive hover:text-destructive/90"
                                            disabled={user.username === 'admin'}
                                            title={user.username === 'admin' ? "Cannot delete default admin" : "Delete user"}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {users.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                                        No users found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
