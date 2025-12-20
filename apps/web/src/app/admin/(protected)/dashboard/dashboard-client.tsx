'use client';

import { UploadDropzone } from "@/components/upload-dropzone";
import { ImageManager } from "@/components/image-manager";
import { useTranslation } from "@/components/i18n-provider";

interface DashboardClientProps {
    images: any;
    topics: any;
    tags: any;
}

export function DashboardClient({ images, topics, tags }: DashboardClientProps) {
    const { t } = useTranslation();

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
                </div>
            </div>

            {/* <div className="border-t pt-8">
                 <AdminUserManager users={adminUsers} />
            </div> */}
        </div>
    );
}
