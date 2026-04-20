import { TagManager } from "./tag-manager";
import { getAdminTags } from "@/app/actions";

export const dynamic = 'force-dynamic';

export default async function TagsPage() {
    const { tags } = await getAdminTags();

    return (
        <div className="max-w-4xl">
            <TagManager initialTags={tags || []} />
        </div>
    );
}
