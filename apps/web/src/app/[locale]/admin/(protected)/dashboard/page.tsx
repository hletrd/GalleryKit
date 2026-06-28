import { getAdminImagesLite, getTopics, getTags, getImageCount, getSeoSettings, getFailedImages } from "@/lib/data";
import { getGalleryConfig } from "@/lib/gallery-config";
import { DashboardClient } from "./dashboard-client";
import { MAX_TOTAL_UPLOAD_BYTES, MAX_UPLOAD_FILE_BYTES, UPLOAD_MAX_FILES_PER_WINDOW } from "@/lib/upload-limits";
import { parsePageParam } from "@/lib/pagination";

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
    const { page: pageParam } = await searchParams;
    const page = parsePageParam(pageParam, 1000);
    const offset = (page - 1) * PAGE_SIZE;

    const [images, topics, tags, totalCount, config, seo, failedImages] = await Promise.all([
        getAdminImagesLite(PAGE_SIZE, offset, true),
        getTopics(),
        getTags(),
        getImageCount(undefined, undefined, { includeUnprocessed: true }),
        getGalleryConfig(),
        getSeoSettings(),
        getFailedImages(),
    ]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    return (
        <DashboardClient
            images={images}
            failedImages={failedImages}
            topics={topics}
            tags={tags}
            page={page}
            totalPages={totalPages}
            imageSizes={config.imageSizes}
            shareBaseUrl={seo.url}
            uploadLimits={{ maxFiles: UPLOAD_MAX_FILES_PER_WINDOW, maxFileBytes: MAX_UPLOAD_FILE_BYTES, maxTotalBytes: MAX_TOTAL_UPLOAD_BYTES }}
        />
    );
}
