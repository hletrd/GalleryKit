'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { createTopic, updateTopic, deleteTopic, createTopicAlias, deleteTopicAlias } from '@/app/actions';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, ChevronLeft, X, Loader2 } from 'lucide-react';
import { useTranslation } from "@/components/i18n-provider";
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';

type Topic = {
    slug: string;
    label: string;
    order: number | null;
    image_filename: string | null;
    aliases: string[];
};

export function TopicManager({ initialTopics }: { initialTopics: Topic[] }) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
    const [newAlias, setNewAlias] = useState('');
    const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
    const [deleteAliasInfo, setDeleteAliasInfo] = useState<{ topicSlug: string; alias: string } | null>(null);
    const [isDeletingTopic, setIsDeletingTopic] = useState(false);
    const [isDeletingAlias, setIsDeletingAlias] = useState(false);

    async function handleCreate(formData: FormData) {
        const res = await createTopic(formData);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.created'));
            setIsCreateOpen(false);
            router.refresh();
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
            router.refresh();
        }
    }

    async function handleDelete(slug: string) {
        setIsDeletingTopic(true);
        const res = await deleteTopic(slug);
        setIsDeletingTopic(false);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.deleted'));
            router.refresh();
        }
    }

    async function handleAddAlias(topicSlug: string) {
        if (!newAlias.trim()) return;
        const res = await createTopicAlias(topicSlug, newAlias.trim());
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.aliasAdded'));
            setNewAlias('');
             setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, newAlias.trim()] }) : null);
             router.refresh();
        }
    }

    async function handleDeleteAlias(topicSlug: string, alias: string) {
        setIsDeletingAlias(true);
        const res = await deleteTopicAlias(topicSlug, alias);
        setIsDeletingAlias(false);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.aliasRemoved'));
             setEditingTopic(prev => prev ? ({ ...prev, aliases: prev.aliases.filter(a => a !== alias) }) : null);
             router.refresh();
        }
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href={localizePath(locale, '/admin/dashboard')}>
                        <Button variant="ghost" size="icon" aria-label={t('aria.goBack')}>
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
                        <TableHead>{t('categories.aliases')}</TableHead>
                        <TableHead className="text-right">{t('imageManager.actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {initialTopics.map((topic) => (
                        <TableRow key={topic.slug}>
                            <TableCell>{topic.order}</TableCell>
                            <TableCell>{topic.label}</TableCell>
                            <TableCell>{topic.slug}</TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {topic.aliases?.map(alias => (
                                        <span key={alias} className="px-2 py-0.5 bg-muted rounded-full text-xs">
                                            {alias}
                                        </span>
                                    ))}
                                </div>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                                <Button variant="ghost" size="icon" onClick={() => setEditingTopic(topic)} aria-label={t('aria.editItem')}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteSlug(topic.slug)} aria-label={t('aria.deleteItem')}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            {/* Delete Topic Confirmation */}
            <AlertDialog open={!!deleteSlug} onOpenChange={(open) => !open && setDeleteSlug(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('categories.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('categories.deleteConfirm')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (deleteSlug) handleDelete(deleteSlug); setDeleteSlug(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isDeletingTopic}>
                            {isDeletingTopic && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isDeletingTopic ? t('imageManager.deleting') : t('imageManager.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={!!editingTopic} onOpenChange={(open) => !open && setEditingTopic(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{t('categories.edit')}</DialogTitle>
                    </DialogHeader>
                    {editingTopic && (
                        <div className="space-y-6">
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

                            <div className="border-t pt-4">
                                <h3 className="text-sm font-medium mb-3">{t('categories.aliases')}</h3>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {editingTopic.aliases.map(alias => (
                                        <div key={alias} className="flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm">
                                            <span>{alias}</span>
                                            <button
                                              onClick={() => setDeleteAliasInfo({ topicSlug: editingTopic.slug, alias })}
                                              className="text-muted-foreground hover:text-destructive"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {editingTopic.aliases.length === 0 && <span className="text-sm text-muted-foreground italic">{t('categories.noAliases')}</span>}
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder={t('categories.aliasPlaceholder')}
                                        value={newAlias}
                                        onChange={(e) => setNewAlias(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddAlias(editingTopic.slug);
                                            }
                                        }}
                                        className="max-w-[200px]"
                                    />
                                    <Button type="button" variant="secondary" onClick={() => handleAddAlias(editingTopic.slug)}>{t('categories.add')}</Button>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Alias Confirmation */}
            <AlertDialog open={!!deleteAliasInfo} onOpenChange={(open) => !open && setDeleteAliasInfo(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('categories.deleteAliasTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('categories.deleteAliasConfirm')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (deleteAliasInfo) handleDeleteAlias(deleteAliasInfo.topicSlug, deleteAliasInfo.alias); setDeleteAliasInfo(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isDeletingAlias}>
                            {isDeletingAlias && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isDeletingAlias ? t('imageManager.deleting') : t('imageManager.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
