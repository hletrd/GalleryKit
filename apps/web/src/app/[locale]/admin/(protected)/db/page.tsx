'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dumpDatabase, restoreDatabase, exportImagesCsv } from '@/app/[locale]/admin/db-actions';
import { toast } from 'sonner';
import { Download, Upload, FileJson, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslations } from 'next-intl';

export default function DbPage() {
    const t = useTranslations('db');
    const [isPending, startTransition] = useTransition();
    const [restoreFile, setRestoreFile] = useState<File | null>(null);

    const handleBackup = () => {
        startTransition(async () => {
            try {
                const result = await dumpDatabase();
                if (result.success && result.url) {
                    const link = document.createElement('a');
                    link.href = result.url;
                    link.download = result.url.split('/').pop() || 'backup.sql';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success(t('successBackup'));
                } else {
                    toast.error(`${t('errorBackup')}: ${result.error}`);
                }
            } catch (e: unknown) {
                toast.error(`${t('errorBackup')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        });
    };

    const handleRestore = () => {
        if (!restoreFile) return;

        if (!confirm(t('confirmRestore'))) {
            return;
        }

        const formData = new FormData();
        formData.append('file', restoreFile);

        startTransition(async () => {
            try {
                const result = await restoreDatabase(formData);
                if (result.success) {
                    toast.success(t('successRestore'));
                    setRestoreFile(null);
                    // Optional: reload page or logout
                    window.location.reload();
                } else {
                    toast.error(`${t('errorRestore')}: ${result.error}`);
                }
            } catch (e: unknown) {
                toast.error(`${t('errorRestore')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        });
    };

    const handleExportCsv = () => {
        startTransition(async () => {
            try {
                const csvData = await exportImagesCsv();
                const blob = new Blob([csvData], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `images-export-${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                toast.success(t('successExport'));
            } catch (e: unknown) {
                toast.error(`${t('errorExport')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        });
    };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Backup Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Download className="h-5 w-5" />
                            {t('backupTitle')}
                        </CardTitle>
                        <CardDescription>
                            {t('backupDesc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button
                            onClick={handleBackup}
                            disabled={isPending}
                            className="w-full"
                        >
                            {isPending ? t('backupButtonProcessing') : t('backupButton')}
                        </Button>
                    </CardContent>
                </Card>

                {/* Restore Card */}
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                            <Upload className="h-5 w-5" />
                            {t('restoreTitle')}
                        </CardTitle>
                        <CardDescription>
                            {t('restoreDesc')}
                            <span className="font-bold text-destructive block mt-1">{t('restoreWarning')}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="restore-file">{t('restoreSelectFile')}</Label>
                            <Input
                                id="restore-file"
                                type="file"
                                accept=".sql"
                                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                                disabled={isPending}
                            />
                        </div>
                        <Alert variant="destructive" className="py-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>{t('dangerZone')}</AlertTitle>
                            <AlertDescription>
                                {t('dangerZoneDesc')}
                            </AlertDescription>
                        </Alert>
                        <Button
                            onClick={handleRestore}
                            disabled={isPending || !restoreFile}
                            variant="destructive"
                            className="w-full"
                        >
                            {isPending ? t('restoreButtonProcessing') : t('restoreButton')}
                        </Button>
                    </CardContent>
                </Card>

                {/* Export CSV Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileJson className="h-5 w-5" />
                            {t('exportTitle')}
                        </CardTitle>
                        <CardDescription>
                            {t('exportDesc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                         <Button
                            onClick={handleExportCsv}
                            disabled={isPending}
                            variant="secondary"
                            className="w-full"
                        >
                            {isPending ? t('exportButtonProcessing') : t('exportButton')}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
