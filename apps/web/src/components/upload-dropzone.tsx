'use client';

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileRejection } from 'react-dropzone';
import { useRouter } from 'next/navigation';
import { uploadImages } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Card, CardContent } from '@/components/ui/card';
import { UploadCloud, X } from 'lucide-react';

import { toast } from 'sonner';
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "@/components/i18n-provider";
import { TagInput } from "@/components/tag-input";

export interface PendingUploadItem {
    id: string;
    file: File;
}

interface UploadLimits {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
}

export function createPendingUploadItems(
    acceptedFiles: File[],
    createId: () => string = () => crypto.randomUUID()
): PendingUploadItem[] {
    return acceptedFiles.map((file) => ({ id: createId(), file }));
}

function formatBytes(bytes: number) {
    const mib = 1024 * 1024;
    const gib = 1024 * mib;
    if (bytes >= gib && bytes % gib === 0) return `${bytes / gib}GB`;
    if (bytes >= mib) return `${Math.round(bytes / mib)}MB`;
    return `${bytes}B`;
}

export function UploadDropzone({
    topics,
    availableTags,
    uploadLimits = { maxFiles: 100, maxFileBytes: 200 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 },
}: {
    topics: { slug: string, label: string }[];
    availableTags: { id: number, name: string, slug: string }[];
    uploadLimits?: UploadLimits;
}) {
    const router = useRouter();
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [topic, setTopic] = useState<string>(topics[0]?.slug || '');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [files, setFiles] = useState<PendingUploadItem[]>([]);
    const filesRef = useRef<PendingUploadItem[]>([]);
    const [perFileTags, setPerFileTags] = useState<Record<string, string[]>>({});
    const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
    const { t } = useTranslation();
    const hasTopics = topics.length > 0;

    // Refs for accessing latest state during async upload loop
    const selectedTagsRef = useRef(selectedTags);
    const perFileTagsRef = useRef(perFileTags);

    useEffect(() => {
        selectedTagsRef.current = selectedTags;
    }, [selectedTags]);

    useEffect(() => {
        perFileTagsRef.current = perFileTags;
    }, [perFileTags]);

    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    // Incremental object URL management — only creates/revoke URLs for
    // added/removed files instead of recreating all URLs on every change.
    const previewUrlsRef = useRef<Map<string, string>>(new Map());
    const [previewVersion, setPreviewVersion] = useState(0);

    useEffect(() => {
        const currentIds = new Set(files.map(({ id }) => id));
        let changed = false;

        // Revoke URLs for removed files
        for (const [id, url] of previewUrlsRef.current) {
            if (!currentIds.has(id)) {
                URL.revokeObjectURL(url);
                previewUrlsRef.current.delete(id);
                changed = true;
            }
        }

        // Create URLs for new files
        for (const { id, file } of files) {
            if (!previewUrlsRef.current.has(id)) {
                previewUrlsRef.current.set(id, URL.createObjectURL(file));
                changed = true;
            }
        }

        // Force re-render if URLs changed
        if (changed) setPreviewVersion(v => v + 1);
    }, [files]);

    // Cleanup all URLs on unmount
    useEffect(() => {
        const urls = previewUrlsRef.current;
        return () => {
            for (const url of urls.values()) {
                URL.revokeObjectURL(url);
            }
            urls.clear();
        };
    }, []);

    // Access the URL map in render (previewVersion ensures re-render on changes)
    const previewUrls = previewVersion >= 0 ? previewUrlsRef.current : previewUrlsRef.current;

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const currentFiles = filesRef.current;
        const existingBytes = currentFiles.reduce((sum, item) => sum + item.file.size, 0);
        const remainingFiles = Math.max(uploadLimits.maxFiles - currentFiles.length, 0);
        const remainingBytes = Math.max(uploadLimits.maxTotalBytes - existingBytes, 0);
        const nextFiles: File[] = [];
        let nextBytes = 0;

        for (const file of acceptedFiles) {
            if (
                file.size > uploadLimits.maxFileBytes
                || nextFiles.length >= remainingFiles
                || nextBytes + file.size > remainingBytes
            ) {
                continue;
            }
            nextFiles.push(file);
            nextBytes += file.size;
        }

        const rejectedCount = acceptedFiles.length - nextFiles.length;
        if (rejectedCount > 0) {
            toast.error(t('upload.limitExceeded', {
                maxFiles: uploadLimits.maxFiles,
                maxFileSize: formatBytes(uploadLimits.maxFileBytes),
                maxSize: formatBytes(uploadLimits.maxTotalBytes),
            }));
        }

        if (nextFiles.length > 0) {
            const pendingItems = createPendingUploadItems(nextFiles);
            const updatedFiles = [...currentFiles, ...pendingItems];
            filesRef.current = updatedFiles;
            setFiles(updatedFiles);
        }
    }, [t, uploadLimits.maxFiles, uploadLimits.maxFileBytes, uploadLimits.maxTotalBytes]);

    const acceptedImageTypes = useMemo(() => ({
        'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.arw', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp']
    }), []);

    const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
        if (fileRejections.length === 0) return;
        const names = fileRejections.slice(0, 3).map(({ file }) => file.name).join(', ');
        const extraCount = fileRejections.length - Math.min(fileRejections.length, 3);
        const reason = fileRejections[0]?.errors[0]?.message ?? t('upload.failed');
        toast.error(
            extraCount > 0
                ? `${names} +${extraCount} — ${reason}`
                : `${names} — ${reason}`,
        );
    }, [t]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        onDropRejected,
        accept: acceptedImageTypes,
        disabled: uploading || !hasTopics,
    });

    const handleUpload = async () => {
        if (!files.length || !hasTopics) return;
        setUploading(true);
        setProgress(0);
        setCompletedCount(0);
        setFileErrors({});

        try {
            let successCount = 0;
            const failedFiles: File[] = [];
            const uploadWarnings: string[] = [];
            const totalFiles = files.length;
            let completedSoFar = 0;

            const uploadFile = async ({ id, file }: PendingUploadItem) => {
                const fileId = id;

                const formData = new FormData();
                formData.append('files', file);
                formData.append('topic', topic);

                // Merge global selectedTags and per-file tags using LATEST values from Ref
                const currentPerFileTags = perFileTagsRef.current;
                const currentSelectedTags = selectedTagsRef.current;

                const localTags = currentPerFileTags[fileId] || [];
                // Dedup tags
                const allTags = Array.from(new Set([...currentSelectedTags, ...localTags]));
                formData.append('tags', allTags.join(','));

                try {
                    const res = await uploadImages(formData);
                    if (res?.error) {
                        console.error(`Failed to upload ${file.name}:`, res.error);
                        setFileErrors(prev => ({ ...prev, [fileId]: res.error }));
                        failedFiles.push(file);
                    } else {
                        successCount++;
                        if (res?.warnings?.length) {
                            uploadWarnings.push(...res.warnings);
                            setFileErrors(prev => ({ ...prev, [fileId]: res.warnings.join(' ') }));
                        }
                    }
                } catch (e) {
                    console.error(`Failed to upload ${file.name}:`, e);
                    setFileErrors(prev => ({ ...prev, [fileId]: t('upload.failed') }));
                    failedFiles.push(file);
                }

                completedSoFar++;
                setCompletedCount(completedSoFar);
                setProgress(Math.round((completedSoFar / totalFiles) * 100));
            };

            // The server serializes uploads against the settings/output-size
            // contract with one named MySQL lock. Sending sibling files in
            // parallel makes the client compete with itself and can produce
            // spurious "upload settings locked" failures, so keep the client
            // side sequential until the server grows reader/writer semantics.
            for (const item of files) {
                await uploadFile(item);
            }

            if (failedFiles.length === 0) {
                if (uploadWarnings.length > 0) {
                    toast.warning(t('upload.warningSuccess', { count: successCount, warnings: uploadWarnings.length }));
                } else {
                    toast.success(t('upload.success', { count: successCount }));
                }
                // Remove uploaded files from the list, keeping any new ones that might have been added
                const uploadedIds = new Set(files.map(({ id }) => id));
                const remainingFiles = filesRef.current.filter(({ id }) => !uploadedIds.has(id));
                filesRef.current = remainingFiles;
                setFiles(remainingFiles);
                setSelectedTags([]);
                setPerFileTags({});
                setFileErrors({});
                router.refresh();
            } else {
                toast.warning(t('upload.partialSuccess', { count: successCount, failed: failedFiles.length }));
                // Keep failed files and any new files
                const failedSet = new Set(failedFiles);
                const attemptedIds = new Set(files.map(({ id }) => id));
                const remainingFiles = filesRef.current.filter((item) => failedSet.has(item.file) || !attemptedIds.has(item.id));
                filesRef.current = remainingFiles;
                setFiles(remainingFiles);
                setProgress(0);
                if (successCount > 0) {
                    router.refresh();
                }
            }
        } catch {
            toast.error(t('upload.failed'));
        } finally {
            setUploading(false);
        }
    };


    const removeFile = (index: number) => {
        const fileToRemove = filesRef.current[index];
        if (!fileToRemove) return;
        const remainingFiles = filesRef.current.filter((_, i) => i !== index);
        filesRef.current = remainingFiles;
        setFiles(remainingFiles);
        // Cleanup perFileTags? Optional, but good practice
        // We can't easily clean up strictly by index if we remove from middle,
        // but using ID handles it.
        const id = fileToRemove.id;
        const newTags = { ...perFileTags };
        delete newTags[id];
        setPerFileTags(newTags);
        setFileErrors(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    return (
        <Card className="overflow-visible">
            <CardContent className="p-6 space-y-6 overflow-visible">
                <datalist id="available-tags-datalist">
                    {availableTags.map(t => (
                        <option key={t.id} value={t.name} />
                    ))}
                </datalist>
                {!hasTopics ? (
                    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center" role="status">
                        <p className="font-medium">{t('upload.noTopicsTitle')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{t('upload.noTopicsDescription')}</p>
                    </div>
                ) : (
                <div className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="upload-topic" className="text-sm font-medium mb-1 block">{t('upload.topic')}</label>
                        <select
                            id="upload-topic"
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                        >
                            {topics.map(t => (
                                <option key={t.slug} value={t.slug}>{t.label}</option>
                            ))}
                        </select>
                    </div>                    {/* Common Tags Selection */}
                    <div>
                        <label id="upload-tags-label" className="text-sm font-medium mb-1 block">{t('upload.tags')} ({t('home.allTags')})</label>
                        <div role="group" aria-labelledby="upload-tags-label">
                        <TagInput
                            availableTags={availableTags}
                            selectedTags={selectedTags}
                            onTagsChange={setSelectedTags}
                            placeholder={t('upload.addExistingTag')}
                        />
                        </div>
                    </div>
                </div>
                )}

                {/* Dropzone */}
                <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer transition-colors
                        ${isDragActive ? 'border-primary bg-primary/10' : 'border-muted'}
                        ${uploading || !hasTopics ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'}
                    `}
                >
                    <input {...getInputProps()} disabled={uploading || !hasTopics} />
                    <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="text-lg font-medium">{t('upload.dragDrop')}</p>
                    <p className="text-sm text-muted-foreground">{t('upload.orClick')}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {t('upload.limitHint', { maxFiles: uploadLimits.maxFiles, maxFileSize: formatBytes(uploadLimits.maxFileBytes), maxSize: formatBytes(uploadLimits.maxTotalBytes) })}
                    </p>
                </div>

                {/* Progress Bar during upload */}
                {uploading && (
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>{t('upload.uploadingProgress', { current: completedCount, total: files.length })}</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <Progress
                            value={progress}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progress)}
                            aria-label={t('upload.uploadingProgress', { current: completedCount, total: files.length })}
                        />
                    </div>
                )}

                {/* File Grid */}
                {files.length > 0 && !uploading && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium text-sm">{t('upload.filesSelected', { count: files.length })}</h3>
                            <Button variant="ghost" size="sm" onClick={() => { filesRef.current = []; setFiles([]); }} className="min-h-11 px-3 text-destructive">{t('upload.clearAll')}</Button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {files.map(({ id: fileId, file }, i) => {
                                const localTags = perFileTags[fileId] || [];
                                const previewUrl = previewUrls.get(fileId) || '';
                                const fileError = fileErrors[fileId];

                                return (
                                <Card key={fileId} className="relative group border bg-muted/30">
                                    {/* AGG3-M01 / DSGN3-MED-01: raise the per-preview
                                        REMOVE button to a 44 px touch target (was h-6 w-6
                                        = 24 px, a fat-finger destruction risk on mobile).
                                        The visible icon stays small via the inner `h-4 w-4`
                                        SVG; the button itself clears WCAG 2.5.5. */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute top-1 right-1 h-11 w-11 z-10 bg-background/50 hover:bg-destructive hover:text-white rounded-full sm:opacity-0 sm:group-hover:opacity-100 opacity-100 focus:opacity-100 transition-opacity"
                                        aria-label={t('aria.removeFile')}
                                        onClick={() => removeFile(i)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>

                                    <div className="aspect-square relative flex items-center justify-center bg-black/5 overflow-hidden">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={previewUrl}
                                            alt={file.name}
                                            className="h-full w-full object-contain"
                                        />
                                    </div>

                                    <div className="p-3 space-y-2">
                                        <div className="space-y-0.5">
                                            <p className="font-medium truncate text-xs" title={file.name}>{file.name}</p>
                                            <p className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>

                                        {/* Per-file tags */}
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
                                                {/* Global tags (dimmed) */}
                                                {selectedTags.map(tag => (
                                                    <span key={`g-${tag}`} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground opacity-60 cursor-not-allowed">
                                                        {tag}
                                                    </span>
                                                ))}
                                                {/* Local tags are handled inside TagInput now, but for preview we might want them?
                                                   Actually TagInput handles display of its own tags. We don't need this separate display if TagInput shows them.
                                                   Wait, checking TagInput implementation. Yes it shows badges.
                                                   So we can remove this separate badge list for local tags.
                                                   Global tags display might still be useful to see "what will be added".
                                                   TagInput shows selectedTags.
                                                   If we use TagInput for per-file tags, it will show the local tags inside itself.
                                                   We should keep global tags display outside or pre-fill them?
                                                   The current design is: Global tags are merged on upload.
                                                   So global tags are implicitly added to everything.
                                                   Let's keep global tags non-editable display here to remind user.
                                                */}
                                            </div>

                                            <div className="flex flex-col gap-2">
                                                <TagInput
                                                    availableTags={availableTags}
                                                    selectedTags={localTags}
                                                    onTagsChange={(newTags) => {
                                                        setPerFileTags(prev => ({
                                                            ...prev,
                                                            [fileId]: newTags
                                                        }));
                                                    }}
                                                    placeholder={t('upload.addTagPlaceholder')}
                                                    ariaLabel={t('upload.tagsForFile', { file: file.name })}
                                                    className="w-full text-xs"
                                                />
                                            </div>
                                            {fileError && (
                                                <p className="text-xs text-destructive" role="alert">
                                                    {t('upload.fileError', { file: file.name, error: fileError })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            )})}
                        </div>
                    </div>
                )}

                {/* Upload Button */}
                {!uploading && (
                    <Button
                        className="w-full"
                        size="lg"
                        onClick={handleUpload}
                        disabled={files.length === 0 || !hasTopics}
                    >
                        {t('upload.uploadButton', { count: files.length })}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
