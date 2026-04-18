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
    // DialogTrigger
} from "@/components/ui/dialog";
import { updateTag, deleteTag } from '@/app/actions';
import { toast } from 'sonner';
import { Pencil, Trash2, ChevronLeft } from 'lucide-react';
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
    const router = useRouter();

    async function handleUpdate(formData: FormData) {
        if (!editingTag) return;
        const name = formData.get('name') as string;

        const res = await updateTag(editingTag.id, name);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('tags.updated'));
            setEditingTag(null);
            router.refresh(); // Ensure list updates
        }
    }

    async function handleDelete(id: number) {
        if (!confirm(t('tags.deleteConfirm'))) return;
        const res = await deleteTag(id);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('tags.deleted'));
            router.refresh();
        }
    }

    return (
        <div>
             <div className="flex items-center gap-4 mb-6">
                <Link href={localizePath(locale, '/admin/dashboard')}>
                    <Button variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                </Link>
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
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(tag.id)} aria-label={t('aria.deleteItem')}>
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

            <Dialog open={!!editingTag} onOpenChange={(open) => !open && setEditingTag(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('tags.edit')}</DialogTitle>
                    </DialogHeader>
                    {editingTag && (
                        <form action={handleUpdate} className="space-y-4">
                            <Input name="name" defaultValue={editingTag.name} placeholder={t('tags.name')} required />
                            <Button type="submit">{t('categories.update')}</Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
