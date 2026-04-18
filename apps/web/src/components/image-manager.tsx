'use client';

import { useState, useEffect } from 'react';
import { deleteImage, deleteImages, createGroupShareLink, batchAddTags, batchUpdateImageTags, updateImageMetadata } from '@/app/actions';
import { copyToClipboard } from '@/lib/clipboard';
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Trash2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; // Assuming Textarea exists or I use Input for now, but checking dir showed textarea.tsx
import { OptimisticImage } from './optimistic-image';
import { Pencil } from 'lucide-react';
import { useTranslation } from "@/components/i18n-provider";

interface ImageType {
    id: number;
    filename_avif: string;
    title: string | null;
    topic: string | null;
    created_at: string | Date | null;
    tag_names?: string | null; // GROUP_CONCAT returns null when no tags
    user_filename?: string | null;
    description?: string | null;
}

export function ImageManager({ initialImages, availableTags }: { initialImages: ImageType[], availableTags: { id: number, name: string, slug: string }[] }) {
    const [images, setImages] = useState(initialImages);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [isSharing, setIsSharing] = useState(false);

    // Edit State
    const [editingImage, setEditingImage] = useState<ImageType | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const { t, locale } = useTranslation();

    useEffect(() => {
        setImages(initialImages);
    }, [initialImages]);

    const toggleSelectAll = () => {
        if (selectedIds.size === images.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(images.map(img => img.id)));
        }
    };

    const toggleSelect = (id: number) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const handleDelete = async (id: number) => {
        setDeletingId(id);
        const res = await deleteImage(id);
        if (res?.success) {
            toast.success(t('imageManager.imageDeleted'));
            setImages(prev => prev.filter(img => img.id !== id));
            setSelectedIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        } else {
            toast.error(t('imageManager.deleteFailed'));
        }
        setDeletingId(null);
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        setIsBulkDeleting(true);
        const ids = Array.from(selectedIds);

        try {
            const res = await deleteImages(ids);
            if (res?.success) {
                toast.success(t('imageManager.bulkDeleteSuccess', { count: res.count }));
                if (res.errors && res.errors > 0) {
                    toast.warning(t('imageManager.bulkDeletePartial', { count: res.errors }));
                }
                setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
                setSelectedIds(new Set());
            } else {
                toast.error(res?.error || t('imageManager.deleteFailed'));
            }
        } catch {
            toast.error(t('imageManager.bulkDeleteFailed'));
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const handleShare = async () => {
        if (selectedIds.size === 0) return;
        setIsSharing(true);
        const ids = Array.from(selectedIds);
        try {
            const result = await createGroupShareLink(ids);
            if (result.success) {
                 const url = `${window.location.origin}/${locale}/g/${result.key}`;
                 await copyToClipboard(url);
                 toast.success(t('imageManager.linkCopied'));
                 setSelectedIds(new Set());
            } else {
                 toast.error(result.error || t('imageManager.shareFailed'));
            }
        } catch {
            toast.error(t('imageManager.shareFailed'));
        } finally {
            setIsSharing(false);
        }
    };

    const [isAddingTag, setIsAddingTag] = useState(false);
    const [tagInput, setTagInput] = useState('');

    // ... imports need to be updated to include new actions (I'll do this in a separate chunk to avoid import mess if possible, or just assume they are imported)
    // Actually I need to import them. I'll use a separate replace for imports.


    const handleBatchAddTag = async () => {
         if (!tagInput.trim()) return;
         const res = await batchAddTags(Array.from(selectedIds), tagInput);
         if (res?.success) {
             toast.success(t('imageManager.batchAddSuccess'));
             setIsAddingTag(false);
             setTagInput('');
             setSelectedIds(new Set()); // Optional: clear selection?
         } else {
             toast.error(res?.error || t('imageManager.batchAddFailed'));
         }
    };

    const startEdit = (image: ImageType) => {
        setEditingImage(image);
        setEditTitle(image.title || "");
        setEditDescription(image.description || "");
    };

    const handleSaveEdit = async () => {
        if (!editingImage) return;
        setIsSavingEdit(true);
        try {
            const res = await updateImageMetadata(editingImage.id, editTitle, editDescription);
            if (res.success) {
                toast.success(t('imageManager.updateSuccess'));
                setImages(prev => prev.map(img => img.id === editingImage.id ? { ...img, title: editTitle, description: editDescription } : img));
                setEditingImage(null);
            } else {
                toast.error(res.error || t('imageManager.updateFailed'));
            }
        } catch {
            toast.error(t('imageManager.updateFailed'));
        } finally {
            setIsSavingEdit(false);
        }
    };

    return (
        <div className="space-y-4">
            {selectedIds.size > 0 && (
                <div className="bg-muted/50 p-2 rounded-md flex items-center justify-between">
                    <span className="text-sm font-medium px-2">{t('imageManager.selected', { count: selectedIds.size })}</span>
                    <div className="flex items-center space-x-2">
                        <AlertDialog open={isAddingTag} onOpenChange={setIsAddingTag}>
                            <AlertDialogTrigger asChild>
                                <Button variant="secondary" size="sm">
                                    {t('imageManager.batchAddButton')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>{t('imageManager.batchAddTitle', { count: selectedIds.size })}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {t('imageManager.batchAddDesc')}
                                    </AlertDialogDescription>
                                    <div className="py-2">
                                        <input
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            placeholder={t('imageManager.placeholderTag')}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleBatchAddTag();
                                            }}
                                        />
                                    </div>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel onClick={() => setTagInput('')}>{t('imageManager.cancelAdd')}</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleBatchAddTag}>{t('imageManager.addTag')}</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleShare}
                            disabled={isSharing}
                        >
                            {isSharing ? t('imageManager.sharing') : <><Share2 className="h-4 w-4 mr-2" /> {t('imageManager.share')}</>}
                        </Button>
                        <div className="h-4 w-px bg-border" />
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isBulkDeleting}>
                                    {isBulkDeleting ? t('imageManager.deleting') : t('imageManager.deleteSelected')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>{t('imageManager.deleteConfirmTitle', { count: selectedIds.size })}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {t('imageManager.deleteConfirmDesc')}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleBulkDelete}>{t('imageManager.delete')}</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            )}

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    checked={images.length > 0 && selectedIds.size === images.length}
                                    onChange={toggleSelectAll}
                                    aria-label={t('aria.selectAll')}
                                />
                            </TableHead>
                            <TableHead>{t('imageManager.preview')}</TableHead>
                            <TableHead>{t('imageManager.title')}</TableHead>
                            <TableHead>{t('imageManager.filename')}</TableHead>
                            <TableHead>{t('imageManager.topic')}</TableHead>
                            <TableHead>{t('imageManager.tags')}</TableHead>
                            <TableHead>{t('imageManager.date')}</TableHead>
                            <TableHead className="text-right">{t('imageManager.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {images.map((image) => (
                            <TableRow key={image.id} data-state={selectedIds.has(image.id) ? "selected" : undefined}>
                                <TableCell>
                                     <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={selectedIds.has(image.id)}
                                        onChange={() => toggleSelect(image.id)}
                                        aria-label={t('aria.selectImage', { title: image.title || image.id })}
                                    />
                                </TableCell>
                                <TableCell>
                                    <div className="relative h-32 w-32 overflow-hidden rounded border bg-muted flex items-center justify-center">
                                        <OptimisticImage
                                            src={`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, '_640.avif')}`}
                                            alt={image.title || t('common.photo')}
                                            fill
                                            sizes="128px"
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                </TableCell>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span>{image.title || <span className="text-muted-foreground italic">{t('imageManager.untitled')}</span>}</span>
                                        {image.description && <span className="text-xs text-muted-foreground truncate max-w-[150px]">{image.description}</span>}
                                    </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate" title={image.user_filename || image.filename_avif}>
                                    {image.user_filename || image.filename_avif}
                                </TableCell>
                                <TableCell>{image.topic}</TableCell>
                                <TableCell>
                                    <div className="min-w-[200px]">
                                        <TagInput
                                            availableTags={availableTags}
                                            selectedTags={image.tag_names ? image.tag_names.split(',').filter(Boolean) : []}
                                            onTagsChange={async (newTags) => {
                                                const oldTags = image.tag_names ? image.tag_names.split(',').filter(Boolean) : [];
                                                const added = newTags.filter(t => !oldTags.includes(t));
                                                const removed = oldTags.filter(t => !newTags.includes(t));

                                                if (added.length === 0 && removed.length === 0) return;

                                                const res = await batchUpdateImageTags(image.id, added, removed);
                                                if (res.success) {
                                                    if (res.warnings.length > 0) {
                                                        res.warnings.forEach(w => toast.warning(w));
                                                    }
                                                    toast.success(t('imageManager.tagAdded'));
                                                    setImages(prev => prev.map(img => {
                                                        if (img.id === image.id) {
                                                            return { ...img, tag_names: newTags.join(',') };
                                                        }
                                                        return img;
                                                    }));
                                                } else {
                                                    toast.error(t('imageManager.batchAddFailed'));
                                                }
                                            }}
                                            placeholder={t('imageManager.addTag')}
                                            className="w-full"
                                        />
                                    </div>
                                </TableCell>
                                <TableCell suppressHydrationWarning>{image.created_at ? new Date(image.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '-'}</TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="icon" onClick={() => startEdit(image)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                            <Button variant="destructive" size="icon">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>{t('imageManager.deleteImageConfirmTitle')}</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    {t('imageManager.deleteImageConfirmDesc')}
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDelete(image.id)} disabled={deletingId === image.id}>
                                                    {deletingId === image.id ? t('imageManager.deleting') : t('imageManager.delete')}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {images.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={8} className="h-24 text-center">
                                    {t('imageManager.noImages')}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={!!editingImage} onOpenChange={(open) => !open && setEditingImage(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('imageManager.editTitle')}</DialogTitle>
                        <DialogDescription>{t('imageManager.editDesc')}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="title">{t('imageManager.titleField')}</Label>
                            <Input id="title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={t('imageManager.titleField')} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="description">{t('imageManager.descField')}</Label>
                            <Textarea id="description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder={t('imageManager.descField')} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingImage(null)}>{t('imageManager.cancel')}</Button>
                        <Button onClick={handleSaveEdit} disabled={isSavingEdit}>{isSavingEdit ? t('imageManager.saving') : t('imageManager.save')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
