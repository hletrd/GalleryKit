'use client';

import { useState, useEffect, useRef } from 'react';
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
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OptimisticImage } from './optimistic-image';
import { Pencil } from 'lucide-react';
import { useTranslation } from "@/components/i18n-provider";
import { sizedImageUrl } from '@/lib/image-url';
import { localizeUrl } from '@/lib/locale-path';
import { useRouter } from 'next/navigation';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';
import { countCodePoints } from '@/lib/utils';

interface ImageType {
    id: number;
    filename_avif: string;
    filename_jpeg: string;
    processed: boolean | null;
    title: string | null;
    topic: string | null;
    created_at: string | Date | null;
    tag_names?: string | null; // GROUP_CONCAT returns null when no tags
    user_filename?: string | null;
    description?: string | null;
}

export function ImageManager({
    initialImages,
    availableTags,
    imageSizes = DEFAULT_IMAGE_SIZES,
    shareBaseUrl,
}: {
    initialImages: ImageType[],
    availableTags: { id: number, name: string, slug: string }[],
    imageSizes?: number[],
    shareBaseUrl: string,
}) {
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
    const router = useRouter();

    const selectAllRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < images.length;
        }
    }, [selectedIds, images.length]);

    useEffect(() => {
        setImages(initialImages);
        setSelectedIds(new Set());
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
        try {
            const res = await deleteImage(id);
            if (res?.success) {
                toast.success(t('imageManager.imageDeleted'));
                if (res.cleanupFailureCount) {
                    toast.warning(t('imageManager.deleteCleanupWarning', { count: res.cleanupFailureCount }));
                }
                setImages(prev => prev.filter(img => img.id !== id));
                setSelectedIds(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                });
            } else {
                toast.error(t('imageManager.deleteFailed'));
            }
        } catch (err) {
            console.warn('Failed to delete image:', err);
            toast.error(t('imageManager.deleteFailed'));
        } finally {
            setDeletingId(null);
        }
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
                if (res.cleanupFailureCount) {
                    toast.warning(t('imageManager.bulkDeleteCleanupWarning', { count: res.cleanupFailureCount }));
                }
                const deletedIdSet = new Set(ids);
                setImages(prev => prev.filter(img => !deletedIdSet.has(img.id)));
                setSelectedIds(new Set());
            } else {
                toast.error(res?.error || t('imageManager.deleteFailed'));
            }
        } catch (err) {
            console.warn('Failed to bulk delete images:', err);
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
                 const url = localizeUrl(shareBaseUrl, locale, `/g/${result.key}`);
                 if (await copyToClipboard(url)) {
                     toast.success(t('imageManager.linkCopied'));
                 } else {
                     toast.error(t('imageManager.copyFailed'));
                 }
                 setSelectedIds(new Set());
            } else {
                 toast.error(result.error || t('imageManager.shareFailed'));
            }
        } catch (err) {
            console.warn('Failed to share image:', err);
            toast.error(t('imageManager.shareFailed'));
        } finally {
            setIsSharing(false);
        }
    };

    const [isBatchTagDialogOpen, setIsBatchTagDialogOpen] = useState(false);
    const [isBatchAddingTag, setIsBatchAddingTag] = useState(false);
    const [tagInput, setTagInput] = useState('');

    const handleBatchAddTag = async () => {
         if (!tagInput.trim()) return;
         setIsBatchAddingTag(true);
         try {
             const res = await batchAddTags(Array.from(selectedIds), tagInput);
             if (res?.success) {
                 toast.success(t('imageManager.batchAddSuccess'));
                 setTagInput('');
                 setSelectedIds(new Set());
                 setIsBatchTagDialogOpen(false);
                 router.refresh();
             } else {
                 toast.error(res?.error || t('imageManager.batchAddFailed'));
             }
         } catch (err) {
             console.warn('Failed to batch add tags:', err);
             toast.error(t('imageManager.batchAddFailed'));
         } finally {
             setIsBatchAddingTag(false);
         }
    };

    const startEdit = (image: ImageType) => {
        setEditingImage(image);
        setEditTitle(image.title || "");
        setEditDescription(image.description || "");
    };

    const handleSaveEdit = async () => {
        if (!editingImage) return;
        // C7-MED-03: validate using code-point counting so the client-side limit
        // matches the server-side countCodePoints() validation. The browser's
        // native maxLength counts UTF-16 code units, which is stricter than
        // necessary for supplementary characters (emoji, rare CJK).
        if (editTitle && countCodePoints(editTitle) > 255) {
            toast.error(t('imageManager.titleTooLong'));
            return;
        }
        if (editDescription && countCodePoints(editDescription) > 5000) {
            toast.error(t('imageManager.descTooLong'));
            return;
        }
        setIsSavingEdit(true);
        try {
            const res = await updateImageMetadata(editingImage.id, editTitle, editDescription);
            if (res.success) {
                toast.success(t('imageManager.updateSuccess'));
                // C1R-04: rehydrate from the sanitized values returned by the
                // server so the UI reflects what was actually persisted. The
                // server trims and strips control characters, so the raw
                // editTitle/editDescription can diverge from the stored row.
                const persistedTitle = res.title ?? null;
                const persistedDescription = res.description ?? null;
                setImages(prev => prev.map(img => img.id === editingImage.id
                    ? { ...img, title: persistedTitle, description: persistedDescription }
                    : img));
                setEditingImage(null);
            } else {
                toast.error(res.error || t('imageManager.updateFailed'));
            }
        } catch (err) {
            console.warn('Failed to update image:', err);
            toast.error(t('imageManager.updateFailed'));
        } finally {
            setIsSavingEdit(false);
        }
    };

    return (
        <div className="space-y-4">
            {selectedIds.size > 0 && (
                <div className="sticky top-0 z-20 bg-muted/95 p-2 rounded-md flex flex-col gap-2 border shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium px-2">{t('imageManager.selected', { count: selectedIds.size })}</span>
                    <div className="flex flex-wrap items-center gap-2">
                        <Dialog
                            open={isBatchTagDialogOpen}
                            onOpenChange={(open) => {
                                setIsBatchTagDialogOpen(open);
                                if (!open) {
                                    setTagInput('');
                                }
                            }}
                        >
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm">
                                    {t('imageManager.batchAddButton')}
                                </Button>
                            </DialogTrigger>
                            <DialogContent closeLabel={t('aria.close')}>
                                <DialogHeader>
                                    <DialogTitle>{t('imageManager.batchAddTitle', { count: selectedIds.size })}</DialogTitle>
                                    <div className="py-2">
                                        <Label htmlFor="batch-add-tag-input" className="mb-2 block">
                                            {t('imageManager.addTag')}
                                        </Label>
                                        <Input
                                            id="batch-add-tag-input"
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            placeholder={t('imageManager.placeholderTag')}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    if (!isBatchAddingTag) void handleBatchAddTag();
                                                }
                                            }}
                                        />
                                    </div>
                                </DialogHeader>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => { setTagInput(''); setIsBatchTagDialogOpen(false); }}>{t('imageManager.cancelAdd')}</Button>
                                    <Button onClick={handleBatchAddTag} disabled={isBatchAddingTag || !tagInput.trim()}>
                                        {isBatchAddingTag ? t('imageManager.adding') : t('imageManager.addTag')}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

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
                                    <AlertDialogAction onClick={handleBulkDelete} disabled={isBulkDeleting}>{isBulkDeleting ? t('imageManager.deleting') : t('imageManager.delete')}</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            )}

            <div className="min-w-0 rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[56px]">
                                <label className="inline-flex min-h-8 min-w-8 items-center justify-center">
                                    <span className="sr-only">{t('aria.selectAll')}</span>
                                    <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    className="h-5 w-5 rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    checked={images.length > 0 && selectedIds.size === images.length}
                                    onChange={toggleSelectAll}
                                    aria-label={t('aria.selectAll')}
                                />
                                </label>
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
                                    <label className="inline-flex min-h-8 min-w-8 items-center justify-center">
                                        <span className="sr-only">{t('aria.selectImage', { title: image.title || image.id })}</span>
                                        <input
                                        type="checkbox"
                                        className="h-5 w-5 rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        checked={selectedIds.has(image.id)}
                                        onChange={() => toggleSelect(image.id)}
                                        aria-label={t('aria.selectImage', { title: image.title || image.id })}
                                    />
                                    </label>
                                </TableCell>
                                <TableCell>
                                    <div className="relative h-32 w-32 overflow-hidden rounded border bg-muted flex items-center justify-center">
                                        {image.processed ? (
                                            <OptimisticImage
                                                src={sizedImageUrl('/uploads/jpeg', image.filename_jpeg, 128, imageSizes)}
                                                alt={image.title || t('common.photo')}
                                                fill
                                                sizes="128px"
                                                className="h-full w-full object-contain"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground text-xs text-center p-2" role="status" aria-live="polite">
                                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                                                <span>{t('common.loading')}</span>
                                            </div>
                                        )}
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

                                                try {
                                                    const res = await batchUpdateImageTags(image.id, added, removed);
                                                    if (res.success) {
                                                        if (res.warnings.length > 0) {
                                                            res.warnings.forEach(w => toast.warning(w));
                                                        }
                                                        if (res.added > 0 || res.removed > 0) {
                                                            toast.success(t('imageManager.tagAdded'));
                                                        }
                                                        router.refresh();
                                                    } else {
                                                        toast.error(t('imageManager.batchAddFailed'));
                                                    }
                                                } catch (err) {
                                                    console.warn('Failed to batch add tags:', err);
                                                    toast.error(t('imageManager.batchAddFailed'));
                                                }
                                            }}
                                            placeholder={t('imageManager.addTag')}
                                            ariaLabel={t('imageManager.tagsForImage', { title: image.title || image.user_filename || image.id })}
                                            className="w-full"
                                        />
                                    </div>
                                </TableCell>
                                <TableCell suppressHydrationWarning>{image.created_at ? new Date(image.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '-'}</TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="icon" onClick={() => startEdit(image)} aria-label={t('aria.editItem')}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                            <Button variant="destructive" size="icon" aria-label={t('aria.deleteItem')}>
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
                <DialogContent closeLabel={t('aria.close')}>
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
