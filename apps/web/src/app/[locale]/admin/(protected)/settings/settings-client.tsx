'use client';

import { useState, useTransition, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { updateGallerySettings } from '@/app/actions/settings';
import { getSettingDefaults } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, ChevronLeft, ImageIcon, Grid3X3, Shield, HardDrive, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';

interface SettingsClientProps {
    initialSettings: Record<string, string>;
}

export function SettingsClient({ initialSettings }: SettingsClientProps) {
    const { t, locale } = useTranslation();
    const [isPending, startTransition] = useTransition();
    const defaults = getSettingDefaults();
    const [settings, setSettings] = useState<Record<string, string>>(initialSettings);
    const initialRef = useRef<Record<string, string>>(initialSettings);

    const handleChange = (key: string, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        startTransition(async () => {
            try {
                // Only send changed fields to reduce transaction size and conflict window
                const changed = Object.fromEntries(
                    Object.entries(settings).filter(([k, v]) => v !== initialRef.current[k])
                );
                if (Object.keys(changed).length === 0) {
                    toast.info(t('settings.noChanges'));
                    return;
                }
                const result = await updateGallerySettings(changed);
                if (result.success) {
                    initialRef.current = { ...settings };
                    toast.success(t('settings.saveSuccess'));
                } else {
                    toast.error(result.error || t('settings.saveFailed'));
                }
            } catch {
                toast.error(t('settings.saveFailed'));
            }
        });
    };

    const getPlaceholder = (key: string) => defaults[key as GallerySettingKey] || '';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <Link href={localizePath(locale, '/admin/dashboard')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
                </div>
                <Button onClick={handleSave} disabled={isPending} className="gap-2">
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isPending ? t('settings.saving') : t('settings.save')}
                </Button>
            </div>

            {/* Image Processing */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ImageIcon className="h-5 w-5" />
                        {t('settings.imageProcessingTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.imageProcessingDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-webp">{t('settings.webpQuality')}</Label>
                            <Input
                                id="image-quality-webp"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_webp || ''}
                                onChange={(e) => handleChange('image_quality_webp', e.target.value)}
                                placeholder={getPlaceholder('image_quality_webp')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-avif">{t('settings.avifQuality')}</Label>
                            <Input
                                id="image-quality-avif"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_avif || ''}
                                onChange={(e) => handleChange('image_quality_avif', e.target.value)}
                                placeholder={getPlaceholder('image_quality_avif')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-jpeg">{t('settings.jpegQuality')}</Label>
                            <Input
                                id="image-quality-jpeg"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_jpeg || ''}
                                onChange={(e) => handleChange('image_quality_jpeg', e.target.value)}
                                placeholder={getPlaceholder('image_quality_jpeg')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHint')}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="image-sizes">{t('settings.imageSizes')}</Label>
                        <Input
                            id="image-sizes"
                            value={settings.image_sizes || ''}
                            onChange={(e) => handleChange('image_sizes', e.target.value)}
                            placeholder={getPlaceholder('image_sizes')}
                            pattern="[0-9]+(\s*,\s*[0-9]+)*"
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.imageSizesHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="queue-concurrency">{t('settings.queueConcurrency')}</Label>
                        <Input
                            id="queue-concurrency"
                            type="number"
                            min={1}
                            max={16}
                            value={settings.queue_concurrency || ''}
                            onChange={(e) => handleChange('queue_concurrency', e.target.value)}
                            placeholder={getPlaceholder('queue_concurrency')}
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.queueConcurrencyHint')}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Gallery Display */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Grid3X3 className="h-5 w-5" />
                        {t('settings.galleryDisplayTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.galleryDisplayDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="grid-columns-desktop">{t('settings.columnsDesktop')}</Label>
                            <Input
                                id="grid-columns-desktop"
                                type="number"
                                min={1}
                                max={8}
                                value={settings.grid_columns_desktop || ''}
                                onChange={(e) => handleChange('grid_columns_desktop', e.target.value)}
                                placeholder={getPlaceholder('grid_columns_desktop')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="grid-columns-tablet">{t('settings.columnsTablet')}</Label>
                            <Input
                                id="grid-columns-tablet"
                                type="number"
                                min={1}
                                max={6}
                                value={settings.grid_columns_tablet || ''}
                                onChange={(e) => handleChange('grid_columns_tablet', e.target.value)}
                                placeholder={getPlaceholder('grid_columns_tablet')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="grid-columns-mobile">{t('settings.columnsMobile')}</Label>
                            <Input
                                id="grid-columns-mobile"
                                type="number"
                                min={1}
                                max={3}
                                value={settings.grid_columns_mobile || ''}
                                onChange={(e) => handleChange('grid_columns_mobile', e.target.value)}
                                placeholder={getPlaceholder('grid_columns_mobile')}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.columnsHint')}</p>
                </CardContent>
            </Card>

            {/* Privacy */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        {t('settings.privacyTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.privacyDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="strip-gps">{t('settings.stripGps')}</Label>
                            <p className="text-xs text-muted-foreground">{t('settings.stripGpsHint')}</p>
                        </div>
                        <Switch
                            id="strip-gps"
                            checked={settings.strip_gps_on_upload === 'true'}
                            onCheckedChange={(checked) => handleChange('strip_gps_on_upload', checked ? 'true' : 'false')}
                            aria-label={t('settings.stripGps')}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Upload Limits */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5" />
                        {t('settings.uploadLimitsTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.uploadLimitsDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="max-file-size">{t('settings.maxFileSize')}</Label>
                            <Input
                                id="max-file-size"
                                type="number"
                                min={1}
                                max={1000}
                                value={settings.max_file_size_mb || ''}
                                onChange={(e) => handleChange('max_file_size_mb', e.target.value)}
                                placeholder={getPlaceholder('max_file_size_mb')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.maxFileSizeHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="max-files-batch">{t('settings.maxFilesBatch')}</Label>
                            <Input
                                id="max-files-batch"
                                type="number"
                                min={1}
                                max={500}
                                value={settings.max_files_per_batch || ''}
                                onChange={(e) => handleChange('max_files_per_batch', e.target.value)}
                                placeholder={getPlaceholder('max_files_per_batch')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.maxFilesBatchHint')}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Storage Backend */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5" />
                        {t('settings.storageTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.storageDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="storage-backend">{t('settings.storageBackend')}</Label>
                        <Select
                            value={settings.storage_backend || 'local'}
                            onValueChange={(value) => handleChange('storage_backend', value)}
                        >
                            <SelectTrigger id="storage-backend" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="local">{t('settings.storageLocal')}</SelectItem>
                                <SelectItem value="minio">{t('settings.storageMinio')}</SelectItem>
                                <SelectItem value="s3">{t('settings.storageS3')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{t('settings.storageBackendHint')}</p>
                    </div>
                    {(settings.storage_backend === 'minio' || settings.storage_backend === 's3') && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">
                            {t('settings.storageEnvHint')}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
