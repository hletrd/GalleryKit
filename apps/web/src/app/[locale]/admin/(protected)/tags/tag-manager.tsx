'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { updateTag, deleteTag } from '@/app/actions';
import { toast } from 'sonner';
import { Pencil, Trash2, ChevronLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslation } from "@/components/i18n-provider";
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';

type Tag = {
    id: number;
    name: string;
    count: number;
};

export function TagManager({ initialTags }: { initialTags: Tag[] }) {
    const { t, locale } = useTranslation();
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [deleteId, setDeleteId] = useState<number | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const router = useRouter();

    async function handleUpdate(formData: FormData) {
        if (!editingTag) return;
        const name = formData.get('name') as string;
        try {
            const res = await updateTag(editingTag.id, name);
            if (res?.error) {
                toast.error(res.error);
            } else {
                toast.success(t('tags.updated'));
                setEditingTag(null);
                router.refresh();
            }
        } catch {
            toast.error(t('serverActions.failedToUpdateTag'));
        }
    }

    async function handleDelete(id: number) {
        setIsDeleting(true);
        try {
            const res = await deleteTag(id);
            if (res?.error) {
                toast.error(res.error);
            } else {
                toast.success(t('tags.deleted'));
                router.refresh();
            }
        } catch {
            toast.error(t('serverActions.failedToDeleteTag'));
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <div>
             <div className="flex items-center gap-4 mb-6">
                <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                    <Link href={localizePath(locale, '/admin/dashboard')}>
                        <ChevronLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <h1 className="text-3xl font-bold">{t('tags.title')}</h1>
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('tags.name')}</TableHead>
                        <TableHead>{t('tags.count')}</TableHead>
                        <TableHead className="text-right">{t('imageManager.actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {initialTags.map((tag) => (
                        <TableRow key={tag.id}>
                            <TableCell>{tag.name}</TableCell>
                            <TableCell>{tag.count}</TableCell>
                            <TableCell className="text-right space-x-2">
                                <Button variant="ghost" size="icon" onClick={() => setEditingTag(tag)} aria-label={t('aria.editItem')}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteId(tag.id)} aria-label={t('aria.deleteItem')}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                    {initialTags.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                                {t('tags.noTags')}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>

            {/* Delete Tag Confirmation */}
            <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('tags.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('tags.deleteConfirm')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (deleteId !== null) handleDelete(deleteId); setDeleteId(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isDeleting}>
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isDeleting ? t('imageManager.deleting') : t('imageManager.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={!!editingTag} onOpenChange={(open) => !open && setEditingTag(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('tags.edit')}</DialogTitle>
                    </DialogHeader>
                    {editingTag && (
                        <form action={handleUpdate} className="space-y-4">
                            <Input name="name" defaultValue={editingTag.name} placeholder={t('tags.name')} required maxLength={100} />
                            <Button type="submit">{t('categories.update')}</Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
