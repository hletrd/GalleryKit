'use client';

import { useRef, useState } from 'react';
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
    DialogDescription,
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
    const [editError, setEditError] = useState<string | null>(null);
    const editErrorRef = useRef<HTMLParagraphElement>(null);
    const router = useRouter();
    const deleteTarget = initialTags.find((tag) => tag.id === deleteId) ?? null;

    async function handleUpdate(formData: FormData) {
        if (!editingTag) return;
        setEditError(null);
        const name = formData.get('name') as string;
        try {
            const res = await updateTag(editingTag.id, name);
            if (res?.error) {
                setEditError(res.error);
                toast.error(res.error);
                requestAnimationFrame(() => editErrorRef.current?.focus());
            } else {
                toast.success(t('tags.updated'));
                setEditError(null);
                setEditingTag(null);
                router.refresh();
            }
        } catch {
            const message = t('serverActions.failedToUpdateTag');
            setEditError(message);
            toast.error(message);
            requestAnimationFrame(() => editErrorRef.current?.focus());
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
            <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[520px]">
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
                                <Button variant="ghost" size="icon" onClick={() => { setEditError(null); setEditingTag(tag); }} aria-label={t('tags.editTagAria', { name: tag.name })}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive-text" onClick={() => setDeleteId(tag.id)} aria-label={t('tags.deleteTagAria', { name: tag.name })}>
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
            </div>

            {/* Delete Tag Confirmation.
                DES-R4C14-B: the action used to close the dialog synchronously
                (Radix auto-close + immediate setDeleteId(null)) while the
                async delete was still in flight, so the isDeleting spinner /
                "Deleting…" label / disabled states below were unreachable and
                the admin got no feedback until the toast. preventDefault()
                suppresses the Radix auto-close; the dialog now stays open
                with the spinner until the action settles (handleDelete
                resolves on both success and error — it catches internally),
                and ESC / overlay / Cancel are inert mid-flight. */}
            <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteId(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('tags.deleteConfirmTitle', { name: deleteTarget?.name ?? '' })}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('tags.deleteConfirm', { name: deleteTarget?.name ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>{t('imageManager.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async (e) => {
                                e.preventDefault();
                                if (deleteId === null || isDeleting) return;
                                await handleDelete(deleteId);
                                setDeleteId(null);
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isDeleting}
                        >
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isDeleting ? t('imageManager.deleting') : t('imageManager.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={!!editingTag}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditError(null);
                        setEditingTag(null);
                    }
                }}
            >
                <DialogContent closeLabel={t('aria.close')}>
                    <DialogHeader>
                        <DialogTitle>{t('tags.edit')}</DialogTitle>
                        <DialogDescription>{t('tags.editDescription')}</DialogDescription>
                    </DialogHeader>
                    {editingTag && (
                        <form action={handleUpdate} className="space-y-4">
                            {editError && (
                                <p id="edit-tag-error" ref={editErrorRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
                                    {editError}
                                </p>
                            )}
                            <div className="grid w-full items-center gap-1.5">
                                <label htmlFor="edit-tag-name" className="text-sm font-medium leading-none">{t('tags.name')}</label>
                                <Input id="edit-tag-name" name="name" defaultValue={editingTag.name} placeholder={t('tags.name')} required maxLength={100} aria-invalid={!!editError} aria-describedby={editError ? 'edit-tag-error' : undefined} />
                            </div>
                            <Button type="submit">{t('categories.update')}</Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
