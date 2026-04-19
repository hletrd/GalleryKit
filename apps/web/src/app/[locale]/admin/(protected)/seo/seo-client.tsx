'use client';

import { useState, useTransition, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { updateSeoSettings } from '@/app/actions/seo';
import { Save, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';

interface SeoSettings {
    seo_title: string;
    seo_description: string;
    seo_nav_title: string;
    seo_author: string;
    seo_locale: string;
    seo_og_image_url: string;
}

interface SeoSettingsClientProps {
    initialSettings: SeoSettings;
}

export function SeoSettingsClient({ initialSettings }: SeoSettingsClientProps) {
    const { t, locale } = useTranslation();
    const [isPending, startTransition] = useTransition();
    const [settings, setSettings] = useState<SeoSettings>(initialSettings);
    const initialRef = useRef<SeoSettings>(initialSettings);

    const handleChange = (field: keyof SeoSettings, value: string) => {
        setSettings(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        startTransition(async () => {
            try {
                // Only send changed fields to reduce transaction size and conflict window
                const changed = Object.fromEntries(
                    Object.entries(settings).filter(([k, v]) => v !== initialRef.current[k as keyof SeoSettings])
                );
                if (Object.keys(changed).length === 0) {
                    toast.info(t('seo.noChanges'));
                    return;
                }
                const result = await updateSeoSettings(changed);
                if (result.success) {
                    initialRef.current = { ...settings };
                    toast.success(t('seo.saveSuccess'));
                } else {
                    toast.error(result.error || t('seo.saveFailed'));
                }
            } catch {
                toast.error(t('seo.saveFailed'));
            }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <Link href={localizePath(locale, '/admin/dashboard')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <h1 className="text-3xl font-bold tracking-tight">{t('seo.title')}</h1>
                </div>
                <Button onClick={handleSave} disabled={isPending} className="gap-2">
                    <Save className="h-4 w-4" />
                    {isPending ? t('seo.saving') : t('seo.save')}
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>{t('seo.generalTitle')}</CardTitle>
                    <CardDescription>{t('seo.generalDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="seo-title">{t('seo.siteTitle')}</Label>
                        <Input
                            id="seo-title"
                            value={settings.seo_title}
                            onChange={(e) => handleChange('seo_title', e.target.value)}
                            placeholder={t('seo.siteTitlePlaceholder')}
                            maxLength={200}
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.siteTitleHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-nav-title">{t('seo.navTitle')}</Label>
                        <Input
                            id="seo-nav-title"
                            value={settings.seo_nav_title}
                            onChange={(e) => handleChange('seo_nav_title', e.target.value)}
                            placeholder={t('seo.navTitlePlaceholder')}
                            maxLength={100}
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.navTitleHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-description">{t('seo.siteDescription')}</Label>
                        <Textarea
                            id="seo-description"
                            value={settings.seo_description}
                            onChange={(e) => handleChange('seo_description', e.target.value)}
                            placeholder={t('seo.siteDescriptionPlaceholder')}
                            maxLength={500}
                            rows={3}
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.siteDescriptionHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-author">{t('seo.author')}</Label>
                        <Input
                            id="seo-author"
                            value={settings.seo_author}
                            onChange={(e) => handleChange('seo_author', e.target.value)}
                            placeholder={t('seo.authorPlaceholder')}
                            maxLength={200}
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.authorHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-locale">{t('seo.locale')}</Label>
                        <Input
                            id="seo-locale"
                            value={settings.seo_locale}
                            onChange={(e) => handleChange('seo_locale', e.target.value)}
                            placeholder="en_US"
                            maxLength={10}
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.localeHint')}</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('seo.ogTitle')}</CardTitle>
                    <CardDescription>{t('seo.ogDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="seo-og-image">{t('seo.ogImageUrl')}</Label>
                        <Input
                            id="seo-og-image"
                            value={settings.seo_og_image_url}
                            onChange={(e) => handleChange('seo_og_image_url', e.target.value)}
                            placeholder={t('seo.ogImageUrlPlaceholder')}
                            maxLength={500}
                            type="url"
                        />
                        <p className="text-xs text-muted-foreground">{t('seo.ogImageUrlHint')}</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
