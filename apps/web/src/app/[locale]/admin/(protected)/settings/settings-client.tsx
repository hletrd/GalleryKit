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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Save, ChevronLeft, ImageIcon, Shield, Loader2, Play, Brain, Search, ShoppingCart } from 'lucide-react';
import { SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX } from '@/lib/gallery-config-shared';
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

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="force-srgb-derivatives">{t('settings.forceSrgbDerivatives')}</Label>
                            <p id="force-srgb-derivatives-help" className="text-xs text-muted-foreground">
                                {t('settings.forceSrgbDerivativesHint')}
                            </p>
                        </div>
                        <Switch
                            id="force-srgb-derivatives"
                            checked={settings.force_srgb_derivatives === 'true'}
                            onCheckedChange={(checked) => handleChange('force_srgb_derivatives', checked ? 'true' : 'false')}
                            aria-describedby="force-srgb-derivatives-help"
                            aria-label={t('settings.forceSrgbDerivatives')}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="allow-hdr-ingest">{t('settings.allowHdrIngest')}</Label>
                            <p id="allow-hdr-ingest-help" className="text-xs text-muted-foreground">
                                {t('settings.allowHdrIngestHint')}
                            </p>
                        </div>
                        <Switch
                            id="allow-hdr-ingest"
                            checked={settings.allow_hdr_ingest === 'true'}
                            onCheckedChange={(checked) => handleChange('allow_hdr_ingest', checked ? 'true' : 'false')}
                            aria-describedby="allow-hdr-ingest-help"
                            aria-label={t('settings.allowHdrIngest')}
                        />
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

            {/* Slideshow */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Play className="h-5 w-5" />
                        {t('settings.slideshowTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.slideshowDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="slideshow-interval">{t('settings.slideshowInterval')}</Label>
                        <Input
                            id="slideshow-interval"
                            type="number"
                            min={SLIDESHOW_INTERVAL_MIN}
                            max={SLIDESHOW_INTERVAL_MAX}
                            value={settings.slideshow_interval_seconds || ''}
                            onChange={(e) => handleChange('slideshow_interval_seconds', e.target.value)}
                            placeholder={getPlaceholder('slideshow_interval_seconds')}
                            aria-describedby="slideshow-interval-help"
                        />
                        <p id="slideshow-interval-help" className="text-xs text-muted-foreground">{t('settings.slideshowIntervalHint')}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Auto Alt-Text */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5" />
                        {t('settings.autoAltTextTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.autoAltTextDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="auto-alt-text-enabled">{t('settings.autoAltTextEnabled')}</Label>
                            <p id="auto-alt-text-enabled-help" className="text-xs text-muted-foreground">
                                {t('settings.autoAltTextEnabledHint')}
                            </p>
                        </div>
                        <Switch
                            id="auto-alt-text-enabled"
                            checked={settings.auto_alt_text_enabled === 'true'}
                            onCheckedChange={(checked) => handleChange('auto_alt_text_enabled', checked ? 'true' : 'false')}
                            aria-describedby="auto-alt-text-enabled-help"
                            aria-label={t('settings.autoAltTextEnabled')}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Semantic Search */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        {t('settings.semanticSearchTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.semanticSearchDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="semantic-search-mode">{t('settings.semanticSearchMode')}</Label>
                            <p id="semantic-search-mode-help" className="text-xs text-muted-foreground">
                                {t('settings.semanticSearchEnabledHint')}
                            </p>
                        </div>
                        <Select
                            value={settings.semantic_search_mode || 'disabled'}
                            onValueChange={(value) => handleChange('semantic_search_mode', value)}
                        >
                            <SelectTrigger id="semantic-search-mode" className="w-[200px]" aria-describedby="semantic-search-mode-help">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="disabled">{t('settings.semanticSearchModeDisabled')}</SelectItem>
                                <SelectItem value="stub">{t('settings.semanticSearchModeStub')}</SelectItem>
                                <SelectItem value="production">{t('settings.semanticSearchModeProduction')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {settings.semantic_search_mode === 'production' && (
                        <p className="text-xs text-amber-600 font-medium">
                            {t('settings.semanticSearchProductionWarning')}
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* License Pricing */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5" />
                        {t('settings.licensePricingTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.licensePricingDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="license-price-editorial">{t('settings.licensePriceEditorial')}</Label>
                            <Input
                                id="license-price-editorial"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_editorial_cents || ''}
                                onChange={(e) => handleChange('license_price_editorial_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_editorial_cents')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="license-price-commercial">{t('settings.licensePriceCommercial')}</Label>
                            <Input
                                id="license-price-commercial"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_commercial_cents || ''}
                                onChange={(e) => handleChange('license_price_commercial_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_commercial_cents')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="license-price-rm">{t('settings.licensePriceRm')}</Label>
                            <Input
                                id="license-price-rm"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_rm_cents || ''}
                                onChange={(e) => handleChange('license_price_rm_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_rm_cents')}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.licensePriceHint')}</p>
                </CardContent>
            </Card>
        </div>
    );
}
