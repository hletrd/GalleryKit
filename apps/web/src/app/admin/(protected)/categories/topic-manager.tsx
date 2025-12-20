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
    DialogTrigger,
} from "@/components/ui/dialog";
import { createTopic, updateTopic, deleteTopic } from '@/app/actions';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, ChevronLeft } from 'lucide-react';
import { useTranslation } from "@/components/i18n-provider";
import Link from 'next/link';

type Topic = {
    slug: string;
    label: string;
    order: number | null;
    image_filename: string | null;
};

export function TopicManager({ initialTopics }: { initialTopics: Topic[] }) {
    const { t } = useTranslation();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingTopic, setEditingTopic] = useState<Topic | null>(null);

    async function handleCreate(formData: FormData) {
        const res = await createTopic(formData);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.created'));
            setIsCreateOpen(false);
        }
    }

    async function handleUpdate(formData: FormData) {
        if (!editingTopic) return;
        const res = await updateTopic(editingTopic.slug, formData);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.updated'));
            setEditingTopic(null);
        }
    }

    async function handleDelete(slug: string) {
        if (!confirm(t('categories.deleteConfirm'))) return;
        const res = await deleteTopic(slug);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.deleted'));
        }
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href="/admin/dashboard">
                        <Button variant="ghost" size="icon">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <h1 className="text-3xl font-bold">{t('categories.title')}</h1>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> {t('categories.add')}</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('categories.add')}</DialogTitle>
                        </DialogHeader>
                        <form action={handleCreate} className="space-y-4">
                            <Input name="label" placeholder={t('categories.placeholderLabel')} required />
                            <Input name="slug" placeholder={t('categories.placeholderSlug')} required />
                            <Input type="number" name="order" placeholder={t('categories.placeholderOrder')} />
                            <div className="grid w-full items-center gap-1.5">
                                <label htmlFor="image" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{t('categories.image')}</label>
                                <Input id="image" type="file" name="image" accept="image/*" />
                            </div>
                            <Button type="submit">{t('categories.create')}</Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('categories.order')}</TableHead>
                        <TableHead>{t('categories.label')}</TableHead>
                        <TableHead>{t('categories.slug')}</TableHead>
                        <TableHead className="text-right">{t('imageManager.actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {initialTopics.map((topic) => (
                        <TableRow key={topic.slug}>
                            <TableCell>{topic.order}</TableCell>
                            <TableCell>{topic.label}</TableCell>
                            <TableCell>{topic.slug}</TableCell>
                            <TableCell className="text-right space-x-2">
                                <Button variant="ghost" size="icon" onClick={() => setEditingTopic(topic)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(topic.slug)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Dialog open={!!editingTopic} onOpenChange={(open) => !open && setEditingTopic(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('categories.edit')}</DialogTitle>
                    </DialogHeader>
                    {editingTopic && (
                        <form action={handleUpdate} className="space-y-4">
                            <Input name="label" defaultValue={editingTopic.label} placeholder={t('categories.label')} required />
                            <Input name="slug" defaultValue={editingTopic.slug} placeholder={t('categories.slug')} required />
                            <Input type="number" name="order" defaultValue={editingTopic.order ?? 0} placeholder={t('categories.order')} />
                            <div className="grid w-full items-center gap-1.5">
                                <label htmlFor="edit-image" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{t('categories.image')}</label>
                                <Input id="edit-image" type="file" name="image" accept="image/*" />
                                {editingTopic.image_filename && (
                                    <p className="text-xs text-muted-foreground">{t('categories.currentImage', { name: editingTopic.image_filename })}</p>
                                )}
                            </div>
                            <Button type="submit">{t('categories.update')}</Button>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
