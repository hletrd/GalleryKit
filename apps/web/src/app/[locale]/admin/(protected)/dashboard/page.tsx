import { getImages, getTopics, getTags } from "@/lib/data";
import { DashboardClient } from "./dashboard-client";

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
    const images = await getImages(undefined, undefined, 200, 0, true);
    const topics = await getTopics();
    const tags = await getTags();

    return <DashboardClient images={images} topics={topics} tags={tags} />;
}
