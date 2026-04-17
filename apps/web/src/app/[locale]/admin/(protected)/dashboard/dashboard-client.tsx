'use client';

import Link from "next/link";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ImageManager } from "@/components/image-manager";
import { useTranslation } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DashboardClientProps {
    images: { id: number; filename_avif: string; title: string | null; topic: string | null; created_at: string | Date | null; tag_names?: string | null; user_filename?: string | null; description?: string | null }[];
    topics: { slug: string; label: string }[];
    tags: { id: number; name: string; slug: string }[];
    page: number;
    totalPages: number;
}

export function DashboardClient({ images, topics, tags, page, totalPages }: DashboardClientProps) {
    const { t, locale } = useTranslation();

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                <div>
                    <h2 className="text-xl font-semibold mb-4">{t('dashboard.uploadNew')}</h2>
                    <UploadDropzone topics={topics} availableTags={tags} />
                </div>
                <div>
                    <h2 className="text-xl font-semibold mb-4">{t('dashboard.recentUploads')}</h2>
                    <div className="max-h-[600px] overflow-auto">
                        <ImageManager initialImages={images} availableTags={tags} />
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-4">
                            {page > 1 ? (
                                <Link href={`/${locale}/admin/dashboard?page=${page - 1}`}>
                                    <Button variant="outline" size="sm">
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                        {page - 1}
                                    </Button>
                                </Link>
                            ) : (
                                <Button variant="outline" size="sm" disabled>
                                    <ChevronLeft className="h-4 w-4 mr-1" />
                                </Button>
                            )}
                            <span className="text-sm text-muted-foreground">
                                {page} / {totalPages}
                            </span>
                            {page < totalPages ? (
                                <Link href={`/${locale}/admin/dashboard?page=${page + 1}`}>
                                    <Button variant="outline" size="sm">
                                        {page + 1}
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Button>
                                </Link>
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
