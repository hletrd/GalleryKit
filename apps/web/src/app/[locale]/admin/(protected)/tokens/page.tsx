import { getTranslations } from 'next-intl/server';
import { TokensClient } from './tokens-client';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { adminTokenRouteMetadata } from '../../admin-metadata';

export const dynamic = 'force-dynamic';

export const generateMetadata = adminTokenRouteMetadata;

export default async function TokensPage() {
    const t = await getTranslations('lrToken');
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <Card>
                <CardHeader>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <TokensClient />
                </CardContent>
            </Card>
        </div>
    );
}
