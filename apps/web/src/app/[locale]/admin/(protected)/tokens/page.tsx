import { getTranslations } from 'next-intl/server';
import { TokensClient } from './tokens-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Key } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TokensPage() {
    const t = await getTranslations('lrToken');
    return (
        <div className="max-w-4xl">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5" />
                        {t('title')}
                    </CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <TokensClient />
                </CardContent>
            </Card>
        </div>
    );
}
