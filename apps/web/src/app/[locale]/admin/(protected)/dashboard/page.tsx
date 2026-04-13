import { getImagesLite, getTopics, getTags, getImageCount } from "@/lib/data";
import { DashboardClient } from "./dashboard-client";

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
    const { page: pageParam } = await searchParams;
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [images, topics, tags, totalCount] = await Promise.all([
        getImagesLite(undefined, undefined, PAGE_SIZE, offset, true),
        getTopics(),
        getTags(),
        getImageCount(),
    ]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    return <DashboardClient images={images} topics={topics} tags={tags} page={page} totalPages={totalPages} />;
}
