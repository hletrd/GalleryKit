import { TagManager } from "./tag-manager";
import { getAdminTags } from "@/app/actions";

export default async function TagsPage() {
    const { tags } = await getAdminTags();

    return (
        <div className="space-y-8 container mx-auto py-8">
            <TagManager initialTags={tags || []} />
        </div>
    );
}
