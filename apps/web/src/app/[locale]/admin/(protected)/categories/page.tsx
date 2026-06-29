
import { getTopicsWithAliases } from '@/lib/data';
import { TopicManager } from './topic-manager';
import { adminRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = () => adminRouteMetadata('categories');

export default async function CategoriesPage() {
    const topics = await getTopicsWithAliases();

    return (
        <div className="max-w-4xl">
            <TopicManager initialTopics={topics} />
        </div>
    );
}
