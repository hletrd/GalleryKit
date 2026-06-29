import { TagManager } from "./tag-manager";
import { getAdminTags } from "@/app/actions";
import { adminRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('tags');

export default async function TagsPage() {
    const { tags } = await getAdminTags();

    return (
        <div className="max-w-4xl">
            <TagManager initialTags={tags || []} />
        </div>
    );
}
