'use client';

import { useState, useTransition, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { updateGallerySettings } from '@/app/actions/settings';
import { getSettingDefaults, normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { Switch } from '@/components/ui/switch';
import { Save, ChevronLeft, ImageIcon, Shield, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';

interface SettingsClientProps {
    initialSettings: Record<string, string>;
    hasExistingImages: boolean;
}

export function SettingsClient({ initialSettings, hasExistingImages }: SettingsClientProps) {
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
                    Object.entries(settings)
                        .map(([key, value]) => {
                            if (key === 'image_sizes' && value.trim()) {
                                return [key, normalizeConfiguredImageSizes(value) ?? value] as const;
                            }
                            return [key, value] as const;
                        })
                        .filter(([k, v]) => v !== initialRef.current[k])
                );
                if (Object.keys(changed).length === 0) {
                    toast.info(t('settings.noChanges'));
                    return;
                }
                const result = await updateGallerySettings(changed);
                if (result.success) {
                    // C1R-04: rehydrate from the server-returned normalized
                    // values (including the canonicalized image_sizes string)
                    // so the UI matches what was actually persisted.
                    const persisted = (result.settings ?? changed) as Record<string, string>;
                    const nextSettings = { ...settings, ...persisted };
                    setSettings(nextSettings);
                    initialRef.current = nextSettings;
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
                            disabled={hasExistingImages}
                            aria-describedby="image-sizes-help"
                        />
                        <p id="image-sizes-help" className="text-xs text-muted-foreground">
                            {hasExistingImages ? t('settings.imageSizesLockedHint') : t('settings.imageSizesHint')}
                        </p>
                    </div>
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
	                            <p id="strip-gps-help" className="text-xs text-muted-foreground">
	                                {hasExistingImages ? t('settings.uploadContractLocked') : t('settings.stripGpsHint')}
	                            </p>
	                        </div>
	                        <Switch
	                            id="strip-gps"
	                            checked={settings.strip_gps_on_upload === 'true'}
	                            onCheckedChange={(checked) => handleChange('strip_gps_on_upload', checked ? 'true' : 'false')}
	                            disabled={hasExistingImages}
	                            aria-describedby="strip-gps-help"
	                            aria-label={t('settings.stripGps')}
	                        />
                    </div>
                    {hasExistingImages && (
                        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                            {t('settings.uploadContractLocked')}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
