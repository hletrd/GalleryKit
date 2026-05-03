'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { refundEntitlement, type EntitlementRow } from '@/app/actions/sales';
import { Button } from '@/components/ui/button';

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
    noSales: string;
    errorLoad: string;
}

interface Props {
    rows: EntitlementRow[];
    totalRevenueCents: number;
    t: SalesTranslations;
}

function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

function getStatus(row: EntitlementRow, t: SalesTranslations): string {
    if (row.refunded) return t.statusRefunded;
    if (row.downloadedAt) return t.statusDownloaded;
    if (new Date() > new Date(row.expiresAt)) return t.statusExpired;
    return t.statusPending;
}

export function SalesClient({ rows: initialRows, totalRevenueCents, t }: Props) {
    const [rows, setRows] = useState<EntitlementRow[]>(initialRows);
    const [refundingId, setRefundingId] = useState<number | null>(null);

    async function handleRefund(id: number) {
        if (refundingId !== null) return;
        setRefundingId(id);
        try {
            const result = await refundEntitlement(id);
            if (result.error) {
                toast.error(`${t.refundError}: ${result.error}`);
            } else {
                toast.success(t.refundSuccess);
                setRows((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, refunded: true, downloadedAt: r.downloadedAt } : r))
                );
            }
        } catch {
            toast.error(t.refundError);
        } finally {
            setRefundingId(null);
        }
    }

    const nonRefundedRevenue = rows
        .filter((r) => !r.refunded)
        .reduce((acc, r) => acc + r.amountTotalCents, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t.title}</h1>
                <div className="text-lg font-semibold">
                    {t.totalRevenue}: {formatCents(nonRefundedRevenue || totalRevenueCents)}
                </div>
            </div>

            {t.errorLoad && (
                <div className="text-destructive text-sm">{t.errorLoad}</div>
            )}

            {rows.length === 0 ? (
                <p className="text-muted-foreground">{t.noSales}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b text-left">
                                <th className="py-2 pr-4 font-medium">{t.colDate}</th>
                                <th className="py-2 pr-4 font-medium">{t.colImage}</th>
                                <th className="py-2 pr-4 font-medium">{t.colTier}</th>
                                <th className="py-2 pr-4 font-medium">{t.colEmail}</th>
                                <th className="py-2 pr-4 font-medium">{t.colAmount}</th>
                                <th className="py-2 pr-4 font-medium">{t.colStatus}</th>
                                <th className="py-2 font-medium">{t.colActions}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const status = getStatus(row, t);
                                const canRefund = !row.refunded;
                                return (
                                    <tr key={row.id} className="border-b last:border-0">
                                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                                            {new Date(row.createdAt).toLocaleDateString()}
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
                                            <span className={
                                                row.refunded ? 'text-destructive' :
                                                row.downloadedAt ? 'text-green-600 dark:text-green-400' :
                                                new Date() > new Date(row.expiresAt) ? 'text-muted-foreground' :
                                                'text-amber-600 dark:text-amber-400'
                                            }>
                                                {status}
                                            </span>
                                        </td>
                                        <td className="py-2">
                                            {canRefund && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-11"
                                                    disabled={refundingId === row.id}
                                                    onClick={() => handleRefund(row.id)}
                                                >
                                                    {refundingId === row.id ? t.refunding : t.refundButton}
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
        </div>
    );
}
