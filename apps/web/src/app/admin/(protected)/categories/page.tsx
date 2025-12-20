
import { getTopics } from '@/lib/data';
import { TopicManager } from './topic-manager';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
    const topics = await getTopics();

    return (
        <div className="space-y-8 container mx-auto py-8">
            <TopicManager initialTopics={topics} />
        </div>
    );
}
