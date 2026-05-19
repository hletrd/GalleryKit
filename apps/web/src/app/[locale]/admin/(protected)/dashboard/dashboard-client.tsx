'use client';

import { useState } from 'react';
import Link from "next/link";
import { toast } from 'sonner';
import { UploadDropzone } from "@/components/upload-dropzone";
import { ImageManager } from "@/components/image-manager";
import { useTranslation } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { localizePath } from "@/lib/locale-path";
import { retryFailedImage } from "@/app/actions/images";
import { sizedImageUrl } from "@/lib/image-url";

interface FailedImage {
    id: number;
    filename_jpeg: string;
    user_filename: string | null;
    title: string | null;
    topic: string | null;
    processing_error: string | null;
    failed_at: string | null;
    created_at: string | Date | null;
}

interface DashboardClientProps {
    images: { id: number; filename_avif: string; filename_jpeg: string; processed: boolean | null; title: string | null; topic: string | null; created_at: string | Date | null; tag_names?: string | null; user_filename?: string | null; description?: string | null }[];
    failedImages: FailedImage[];
    topics: { slug: string; label: string }[];
    tags: { id: number; name: string; slug: string }[];
    page: number;
    totalPages: number;
    imageSizes: number[];
    shareBaseUrl: string;
    uploadLimits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
}

export function DashboardClient({ images, failedImages: initialFailed, topics, tags, page, totalPages, imageSizes, shareBaseUrl, uploadLimits }: DashboardClientProps) {
    const { t, locale } = useTranslation();
    const [failedImages, setFailedImages] = useState<FailedImage[]>(initialFailed);
    const [retryingId, setRetryingId] = useState<number | null>(null);

    async function handleRetry(id: number) {
        setRetryingId(id);
        try {
            const result = await retryFailedImage(id);
            if (result && typeof result === 'object' && 'success' in result && result.success) {
                setFailedImages((prev) => prev.filter((img) => img.id !== id));
            } else {
                console.error('Retry failed:', result);
                toast.error(t('dashboard.retryFailed'));
            }
        } catch (err) {
            console.error('Retry error:', err);
            toast.error(t('dashboard.retryFailed'));
        } finally {
            setRetryingId(null);
        }
    }

    return (
        <div className="min-w-0 space-y-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
            </div>

            {/* R10-H2: Failed images section */}
            {failedImages.length > 0 && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
                    <h2 className="text-lg font-semibold text-destructive">
                        {t('dashboard.failedImages', { count: failedImages.length })}
                    </h2>
                    <div className="space-y-2">
                        {failedImages.map((img) => (
                            <div
                                key={img.id}
                                className="flex items-center gap-3 rounded-md bg-background p-2"
                            >
                                <img
                                    src={sizedImageUrl('/uploads/jpeg', img.filename_jpeg, 64, imageSizes)}
                                    alt={img.title ?? img.user_filename ?? ''}
                                    className="h-11 w-11 rounded object-cover shrink-0"
                                    loading="lazy"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">
                                        {img.title ?? img.user_filename ?? `ID ${img.id}`}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {img.processing_error}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    disabled={retryingId === img.id}
                                    onClick={() => handleRetry(img.id)}
                                >
                                    <RotateCcw className="h-4 w-4 mr-1" />
                                    {retryingId === img.id ? t('dashboard.retrying') : t('dashboard.retry')}
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid min-w-0 gap-8 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold mb-4">{t('dashboard.uploadNew')}</h2>
                    <UploadDropzone topics={topics} availableTags={tags} uploadLimits={uploadLimits} />
                </div>
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold mb-4">{t('dashboard.recentUploads')}</h2>
                    <div className="max-w-full max-h-[calc(100vh-16rem)] overflow-auto 2xl:max-h-[calc(100vh-14rem)]">
                        <ImageManager initialImages={images} availableTags={tags} availableTopics={topics} imageSizes={imageSizes} shareBaseUrl={shareBaseUrl} />
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-4">
                            {page > 1 ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={`${localizePath(locale, '/admin/dashboard')}?page=${page - 1}`}>
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                        {page - 1}
                                    </Link>
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" disabled>
                                    <ChevronLeft className="h-4 w-4 mr-1" />
                                </Button>
                            )}
                            <span className="text-sm text-muted-foreground">
                                {page} / {totalPages}
                            </span>
                            {page < totalPages ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={`${localizePath(locale, '/admin/dashboard')}?page=${page + 1}`}>
                                        {page + 1}
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Link>
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" disabled>
                                    <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
