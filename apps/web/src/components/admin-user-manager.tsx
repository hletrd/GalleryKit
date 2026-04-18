'use client';

import { useTranslation } from "@/components/i18n-provider";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { createAdminUser, deleteAdminUser } from "@/app/actions";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";

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
    const [deleteTarget, setDeleteTarget] = useState<{ id: number; username: string } | null>(null);
    const { t, locale } = useTranslation();
    const router = useRouter();

    async function handleCreate(formData: FormData) {
        setIsCreating(true);
        const result = await createAdminUser(formData);
        setIsCreating(false);

        if (result.error) {
            toast.error(result.error);
        } else {
            toast.success(t('users.createSuccess'));
            setOpen(false);
            router.refresh();
        }
    }

    async function handleDelete(id: number) {
        setDeleteTarget(null);
        const result = await deleteAdminUser(id);
        if (result.error) {
            toast.error(result.error);
        } else {
            toast.success(t('users.deleteSuccess'));
            router.refresh();
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>{t('users.adminUsers')}</CardTitle>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm">
                            <UserPlus className="mr-2 h-4 w-4" />
                            {t('users.add')}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('users.createTitle')}</DialogTitle>
                            <DialogDescription>
                                {t('users.createDesc')}
                            </DialogDescription>
                        </DialogHeader>
                        <form action={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('users.username')}</label>
                                <Input name="username" placeholder={t('users.username')} required minLength={3} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('users.password')}</label>
                                <Input name="password" type="password" placeholder={t('users.password')} required minLength={12} />
                                <p className="text-xs text-muted-foreground">{t('password.minLength')}</p>
                            </div>
                            <DialogFooter>
                                <Button type="submit" disabled={isCreating}>
                                    {isCreating ? t('users.creating') : t('users.createButton')}
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
                                <TableHead>{t('users.username')}</TableHead>
                                <TableHead>{t('users.createdAt')}</TableHead>
                                <TableHead className="w-[100px]">{t('users.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        {user.username}
                                    </TableCell>
                                    <TableCell>
                                        {user.created_at ? new Date(user.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setDeleteTarget({ id: user.id, username: user.username })}
                                            className="text-destructive hover:text-destructive/90"
                                            disabled={user.username === 'admin'}
                                            aria-label={t('aria.deleteItem')}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {users.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                                        {t('users.noUsers')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('users.deleteConfirm', { username: deleteTarget?.username ?? '' })}</AlertDialogTitle>
                        <AlertDialogDescription>{t('db.dangerZoneDesc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {t('imageManager.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
