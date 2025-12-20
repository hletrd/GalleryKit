import { TagManager } from "./tag-manager";
import { getTags } from "@/app/actions";

export default async function TagsPage() {
    const { tags } = await getTags();

    return (
        <div className="space-y-8 container mx-auto py-8">
            <TagManager initialTags={tags || []} />
        </div>
    );
}
