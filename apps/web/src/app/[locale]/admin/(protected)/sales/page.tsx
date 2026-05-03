import { getTranslations } from 'next-intl/server';
import { listEntitlements, getTotalRevenueCents } from '@/app/actions/sales';
import { SalesClient } from './sales-client';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
    const t = await getTranslations('sales');

    const [salesResult, revenueResult] = await Promise.all([
        listEntitlements(),
        getTotalRevenueCents(),
    ]);

    return (
        <SalesClient
            rows={salesResult.rows ?? []}
            totalRevenueCents={revenueResult.totalCents ?? 0}
            t={{
                title: t('title'),
                totalRevenue: t('totalRevenue'),
                colDate: t('colDate'),
                colImage: t('colImage'),
                colTier: t('colTier'),
                colEmail: t('colEmail'),
                colAmount: t('colAmount'),
                colStatus: t('colStatus'),
                colActions: t('colActions'),
                statusDownloaded: t('statusDownloaded'),
                statusPending: t('statusPending'),
                statusExpired: t('statusExpired'),
                statusRefunded: t('statusRefunded'),
                refundButton: t('refundButton'),
                refunding: t('refunding'),
                refundSuccess: t('refundSuccess'),
                refundError: t('refundError'),
                noSales: t('noSales'),
                errorLoad: salesResult.error ?? '',
            }}
        />
    );
}
