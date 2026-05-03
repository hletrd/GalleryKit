'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Check, Clock, RotateCcw, XCircle } from 'lucide-react';
import { refundEntitlement, type EntitlementRow, type RefundErrorCode } from '@/app/actions/sales';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SalesTranslations {
    title: string;
    totalRevenue: string;
    colDate: string;
    colImage: string;
    colTier: string;
    colEmail: string;
    colAmount: string;
    colStatus: string;
    colActions: string;
    statusDownloaded: string;
    statusPending: string;
    statusExpired: string;
    statusRefunded: string;
    refundButton: string;
    refunding: string;
    refundSuccess: string;
    refundError: string;
    refundConfirmTitle: string;
    refundConfirmDescTemplate: (vars: { amount: string; email: string; title: string }) => string;
    refundConfirmAction: string;
    refundCancel: string;
    refundErrorAlreadyRefunded: string;
    refundErrorChargeUnknown: string;
    refundErrorNetwork: string;
    refundErrorNotFound: string;
    refundErrorInvalidId: string;
    refundErrorNoPaymentIntent: string;
    noSales: string;
    errorLoad: string;
}

interface Props {
    rows: EntitlementRow[];
    t: SalesTranslations;
}

/** Cycle 2 RPF / P260-04 / C2-RPF-04: locale-aware currency formatting.
 *  Mirrors the photo-viewer Buy-button pattern. The actual Stripe currency
 *  stays USD; only the UI rendering follows visitor locale. */
function makeCurrencyFormatter(locale: string): (cents: number) => string {
    let fmt: Intl.NumberFormat | null = null;
    try {
        fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
    } catch {
        fmt = null;
    }
    return (cents: number): string => {
        if (fmt) return fmt.format(cents / 100);
        return `$${(cents / 100).toFixed(2)}`;
    };
}

type SalesStatus = 'refunded' | 'downloaded' | 'expired' | 'pending';

function computeStatus(row: EntitlementRow): SalesStatus {
    if (row.refunded) return 'refunded';
    if (row.downloadedAt) return 'downloaded';
    if (new Date() > new Date(row.expiresAt)) return 'expired';
    return 'pending';
}

/** Cycle 2 RPF / P260-06 / C2-RPF-09: status icon for color-blind users
 *  (WCAG 1.4.1). Triple-encodes status as text + color + icon. */
function StatusBadge({ status, t }: { status: SalesStatus; t: SalesTranslations }) {
    const cfg: Record<SalesStatus, { label: string; cls: string; Icon: typeof Check }> = {
        refunded: { label: t.statusRefunded, cls: 'text-destructive', Icon: RotateCcw },
        downloaded: { label: t.statusDownloaded, cls: 'text-green-600 dark:text-green-400', Icon: Check },
        expired: { label: t.statusExpired, cls: 'text-muted-foreground', Icon: XCircle },
        pending: { label: t.statusPending, cls: 'text-amber-600 dark:text-amber-400', Icon: Clock },
    };
    const { label, cls, Icon } = cfg[status];
    return (
        <span className={`inline-flex items-center gap-1 ${cls}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
        </span>
    );
}

function mapErrorCode(code: RefundErrorCode | undefined, t: SalesTranslations): string {
    // Cycle 4 RPF / P264-04 / C4-RPF-04: cover the remaining RefundErrorCode
    // values explicitly so operators see actionable messages instead of the
    // generic "Refund failed" fallback. 'unknown' and undefined still fall
    // through to the generic message.
    switch (code) {
        case 'already-refunded':
            return t.refundErrorAlreadyRefunded;
        case 'charge-unknown':
            return t.refundErrorChargeUnknown;
        case 'network':
            return t.refundErrorNetwork;
        case 'not-found':
            return t.refundErrorNotFound;
        case 'invalid-id':
            return t.refundErrorInvalidId;
        case 'no-payment-intent':
            return t.refundErrorNoPaymentIntent;
        default:
            return t.refundError;
    }
}

export function SalesClient({ rows: initialRows, t }: Props) {
    const locale = useLocale();
    const formatCents = useMemo(() => makeCurrencyFormatter(locale), [locale]);
    const [rows, setRows] = useState<EntitlementRow[]>(initialRows);
    const [refundingId, setRefundingId] = useState<number | null>(null);
    const [confirmTarget, setConfirmTarget] = useState<EntitlementRow | null>(null);

    async function handleRefund(id: number) {
        if (refundingId !== null) return;
        setRefundingId(id);
        try {
            const result = await refundEntitlement(id);
            if (!result.success) {
                toast.error(mapErrorCode(result.errorCode, t));
            } else {
                toast.success(t.refundSuccess);
                setRows((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, refunded: true } : r))
                );
            }
        } catch {
            toast.error(t.refundError);
        } finally {
            setRefundingId(null);
            setConfirmTarget(null);
        }
    }

    /**
     * Cycle 2 RPF / P260-05 / C2-RPF-05: compute revenue from loaded rows
     * directly. The previous `nonRefundedRevenue || totalRevenueCents`
     * fallback fired when nonRefundedRevenue === 0 (every entitlement
     * refunded), masking the refund and showing the pre-refund total.
     * Cycle 3 RPF / P262-06 / C3-RPF-06: dropped the `totalRevenueCents`
     * fallback entirely. When rows are empty the displayed revenue is 0,
     * which matches both the empty-state ("No sales yet.") and the
     * error-state semantics. The all-time SUM action was deleted server-side
     * because it was dead code in the post-P260-05 path.
     */
    const displayedRevenueCents = useMemo(
        () => rows.filter((r) => !r.refunded).reduce((acc, r) => acc + r.amountTotalCents, 0),
        [rows],
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t.title}</h1>
                <div className="text-lg font-semibold">
                    {t.totalRevenue}: {formatCents(displayedRevenueCents)}
                </div>
            </div>

            {t.errorLoad && (
                /*
                  Cycle 4 RPF / P264-09 / C4-RPF-09: announce the load
                  failure to assistive tech via role="alert" (a live region).
                  The previous static <div> rendered silently to screen readers.
                */
                <div role="alert" className="text-destructive text-sm">{t.errorLoad}</div>
            )}

            {rows.length === 0 ? (
                <p className="text-muted-foreground">{t.noSales}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <caption className="sr-only">{t.title}</caption>
                        <thead>
                            <tr className="border-b text-left">
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colDate}</th>
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colImage}</th>
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colTier}</th>
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colEmail}</th>
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colAmount}</th>
                                <th scope="col" className="py-2 pr-4 font-medium">{t.colStatus}</th>
                                <th scope="col" className="py-2 font-medium">{t.colActions}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const status = computeStatus(row);
                                const canRefund = !row.refunded;
                                return (
                                    <tr key={row.id} className="border-b last:border-0">
                                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                                            {new Date(row.createdAt).toLocaleDateString(locale)}
                                        </td>
                                        <td className="py-2 pr-4">
                                            <span className="font-medium">
                                                {row.imageTitle ?? `#${row.imageId}`}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-4 capitalize">{row.tier}</td>
                                        <td className="py-2 pr-4 text-muted-foreground">{row.customerEmail}</td>
                                        <td className="py-2 pr-4 font-mono">{formatCents(row.amountTotalCents)}</td>
                                        <td className="py-2 pr-4">
                                            <StatusBadge status={status} t={t} />
                                        </td>
                                        <td className="py-2">
                                            {canRefund && (
                                                /*
                                                  Cycle 3 RPF / P262-08 /
                                                  C3-RPF-08: row Refund button
                                                  reverts to `outline` to keep
                                                  the destructive-emphasis
                                                  budget on the AlertDialog
                                                  confirm action only. Row +
                                                  dialog were both red after
                                                  cycle 2; per shadcn convention
                                                  the trigger should be neutral
                                                  and the confirm action carries
                                                  the destructive variant.
                                                */
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-11"
                                                    disabled={refundingId === row.id}
                                                    onClick={() => setConfirmTarget(row)}
                                                >
                                                    {/*
                                                       Cycle 4 RPF / P264-08 /
                                                       C4-RPF-08: keep row
                                                       button text pinned to
                                                       t.refundButton — the
                                                       in-flight feedback is
                                                       on the AlertDialog
                                                       confirm action button
                                                       only (`disabled` here
                                                       communicates in-flight
                                                       to the row trigger).
                                                       Per shadcn convention,
                                                       only one button rotates
                                                       its label.
                                                    */}
                                                    {t.refundButton}
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/*
                Cycle 2 RPF / P260-02 / C2-RPF-02: refund confirmation dialog.
                Stripe refunds are irreversible — single-click without confirm
                was inconsistent with the cycle 39 confirm-dialog pattern used
                for other destructive admin actions.
            */}
            <AlertDialog
                open={!!confirmTarget}
                onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t.refundConfirmTitle}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmTarget
                                ? t.refundConfirmDescTemplate({
                                    amount: formatCents(confirmTarget.amountTotalCents),
                                    email: confirmTarget.customerEmail,
                                    title: confirmTarget.imageTitle ?? `#${confirmTarget.imageId}`,
                                })
                                : ''}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t.refundCancel}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmTarget && handleRefund(confirmTarget.id)}
                            disabled={refundingId !== null}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {refundingId !== null ? t.refunding : t.refundConfirmAction}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
