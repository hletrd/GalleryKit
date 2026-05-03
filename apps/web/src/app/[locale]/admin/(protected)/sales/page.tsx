import { getTranslations } from 'next-intl/server';
import { listEntitlements } from '@/app/actions/sales';
import { SalesClient } from './sales-client';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
    const t = await getTranslations('sales');

    // Cycle 3 RPF / P262-06 / C3-RPF-06: removed the parallel
    // `getTotalRevenueCents()` call. Revenue is now derived directly from the
    // loaded rows in `sales-client.tsx` (cycle 2 P260-05). The fallback was
    // dead code — when rows are empty, the all-time SUM is also 0, and the
    // only case where the two diverged was a silent listEntitlements failure
    // that the UI also surfaces as "No sales yet."
    const salesResult = await listEntitlements();

    return (
        <SalesClient
            rows={salesResult.rows ?? []}
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
                refundConfirmTitle: t('refundConfirmTitle'),
                refundConfirmDescTemplate: (vars) => t('refundConfirmDesc', vars),
                refundConfirmAction: t('refundConfirmAction'),
                refundCancel: t('refundCancel'),
                refundErrorAlreadyRefunded: t('refundErrorAlreadyRefunded'),
                refundErrorChargeUnknown: t('refundErrorChargeUnknown'),
                refundErrorNetwork: t('refundErrorNetwork'),
                // Cycle 4 RPF / P264-04 / C4-RPF-04: actionable error strings
                // for the previously-unmapped RefundErrorCode values.
                refundErrorNotFound: t('refundErrorNotFound'),
                refundErrorInvalidId: t('refundErrorInvalidId'),
                refundErrorNoPaymentIntent: t('refundErrorNoPaymentIntent'),
                noSales: t('noSales'),
                // Cycle 3 RPF / P262-10 / C3-RPF-10: when listEntitlements
                // returns an error, surface the i18n-translated string so
                // Korean users see Korean text instead of the English server
                // message. The presence of `salesResult.error` is what the
                // client renders against.
                errorLoad: salesResult.error ? t('errorLoad') : '',
            }}
        />
    );
}
