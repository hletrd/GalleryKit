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
import { useRestoreFocusAfterPending } from '@/lib/use-restore-focus-after-pending';

interface SeoSettings {
    seo_title: string;
    seo_description: string;
    seo_nav_title: string;
    seo_author: string;
    seo_locale: string;
    seo_og_image_url: string;
}

type SeoSettingsField = keyof SeoSettings;
type FieldErrors = Partial<Record<SeoSettingsField, string>>;

interface SeoSettingsClientProps {
    initialSettings: SeoSettings;
}

export function SeoSettingsClient({ initialSettings }: SeoSettingsClientProps) {
    const { t, locale } = useTranslation();
    const [isPending, startTransition] = useTransition();
    const [settings, setSettings] = useState<SeoSettings>(initialSettings);
    const [formError, setFormError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const initialRef = useRef<SeoSettings>(initialSettings);
    const saveButtonRef = useRef<HTMLButtonElement>(null);
    const formErrorRef = useRef<HTMLParagraphElement>(null);
    const fieldRefs = useRef<Record<SeoSettingsField, HTMLInputElement | HTMLTextAreaElement | null>>({
        seo_title: null,
        seo_description: null,
        seo_nav_title: null,
        seo_author: null,
        seo_locale: null,
        seo_og_image_url: null,
    });
    useRestoreFocusAfterPending(saveButtonRef, isPending);

    const describedBy = (field: SeoSettingsField, ...ids: string[]) => (
        [
            ...ids,
            fieldErrors[field] ? `${field.replaceAll('_', '-')}-error` : null,
            formError ? 'seo-form-error' : null,
        ].filter(Boolean).join(' ')
    );

    const handleChange = (field: keyof SeoSettings, value: string) => {
        setFormError(null);
        setFieldErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
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
                    setFormError(null);
                    setFieldErrors({});
                    toast.info(t('seo.noChanges'));
                    return;
                }
                const result = await updateSeoSettings(changed);
                if ('success' in result && result.success) {
                    // C1R-04: rehydrate from the sanitized values returned by
                    // the server so trailing whitespace / control chars do
                    // not linger in the UI until the next refresh.
                    const persisted = (result.settings ?? {}) as Partial<Record<keyof SeoSettings, string>>;
                    const nextSettings: SeoSettings = {
                        ...settings,
                        ...persisted,
                    };
                    setSettings(nextSettings);
                    initialRef.current = { ...nextSettings };
                    setFormError(null);
                    setFieldErrors({});
                    toast.success(t('seo.saveSuccess'));
                } else {
                    const message = result.error || t('seo.saveFailed');
                    if ('field' in result && result.field && result.field in fieldRefs.current) {
                        const field = result.field as SeoSettingsField;
                        setFormError(null);
                        setFieldErrors({ [field]: message });
                        requestAnimationFrame(() => fieldRefs.current[field]?.focus());
                    } else {
                        setFormError(message);
                        setFieldErrors({});
                        requestAnimationFrame(() => formErrorRef.current?.focus());
                    }
                    toast.error(message);
                }
            } catch {
                const message = t('seo.saveFailed');
                setFormError(message);
                setFieldErrors({});
                toast.error(message);
                requestAnimationFrame(() => formErrorRef.current?.focus());
            }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                    <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <Link href={localizePath(locale, '/admin/dashboard')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <h1 className="min-w-0 text-3xl font-bold tracking-tight">{t('seo.title')}</h1>
                </div>
                <Button ref={saveButtonRef} onClick={handleSave} disabled={isPending} className="min-h-11 gap-2 self-start sm:self-auto">
                    <Save className="h-4 w-4" />
                    {isPending ? t('seo.saving') : t('seo.save')}
                </Button>
            </div>

            {formError && (
                <p id="seo-form-error" ref={formErrorRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
                    {formError}
                </p>
            )}

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
                            ref={(node) => { fieldRefs.current.seo_title = node; }}
                            value={settings.seo_title}
                            onChange={(e) => handleChange('seo_title', e.target.value)}
                            placeholder={t('seo.siteTitlePlaceholder')}
                            maxLength={200}
                            aria-invalid={!!fieldErrors.seo_title}
                            aria-describedby={describedBy('seo_title', 'seo-title-help')}
                        />
                        <p id="seo-title-help" className="text-xs text-muted-foreground">{t('seo.siteTitleHint')}</p>
                        {fieldErrors.seo_title && <p id="seo-title-error" className="text-sm text-destructive-text">{fieldErrors.seo_title}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-nav-title">{t('seo.navTitle')}</Label>
                        <Input
                            id="seo-nav-title"
                            ref={(node) => { fieldRefs.current.seo_nav_title = node; }}
                            value={settings.seo_nav_title}
                            onChange={(e) => handleChange('seo_nav_title', e.target.value)}
                            placeholder={t('seo.navTitlePlaceholder')}
                            maxLength={100}
                            aria-invalid={!!fieldErrors.seo_nav_title}
                            aria-describedby={describedBy('seo_nav_title', 'seo-nav-title-help')}
                        />
                        <p id="seo-nav-title-help" className="text-xs text-muted-foreground">{t('seo.navTitleHint')}</p>
                        {fieldErrors.seo_nav_title && <p id="seo-nav-title-error" className="text-sm text-destructive-text">{fieldErrors.seo_nav_title}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-description">{t('seo.siteDescription')}</Label>
                        <Textarea
                            id="seo-description"
                            ref={(node) => { fieldRefs.current.seo_description = node; }}
                            value={settings.seo_description}
                            onChange={(e) => handleChange('seo_description', e.target.value)}
                            placeholder={t('seo.siteDescriptionPlaceholder')}
                            maxLength={500}
                            rows={3}
                            aria-invalid={!!fieldErrors.seo_description}
                            aria-describedby={describedBy('seo_description', 'seo-description-help')}
                        />
                        <p id="seo-description-help" className="text-xs text-muted-foreground">{t('seo.siteDescriptionHint')}</p>
                        {fieldErrors.seo_description && <p id="seo-description-error" className="text-sm text-destructive-text">{fieldErrors.seo_description}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-author">{t('seo.author')}</Label>
                        <Input
                            id="seo-author"
                            ref={(node) => { fieldRefs.current.seo_author = node; }}
                            value={settings.seo_author}
                            onChange={(e) => handleChange('seo_author', e.target.value)}
                            placeholder={t('seo.authorPlaceholder')}
                            maxLength={200}
                            aria-invalid={!!fieldErrors.seo_author}
                            aria-describedby={describedBy('seo_author', 'seo-author-help')}
                        />
                        <p id="seo-author-help" className="text-xs text-muted-foreground">{t('seo.authorHint')}</p>
                        {fieldErrors.seo_author && <p id="seo-author-error" className="text-sm text-destructive-text">{fieldErrors.seo_author}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="seo-locale">{t('seo.locale')}</Label>
                        <Input
                            id="seo-locale"
                            ref={(node) => { fieldRefs.current.seo_locale = node; }}
                            value={settings.seo_locale}
                            onChange={(e) => handleChange('seo_locale', e.target.value)}
                            placeholder="en_US"
                            maxLength={10}
                            aria-invalid={!!fieldErrors.seo_locale}
                            aria-describedby={describedBy('seo_locale', 'seo-locale-help')}
                        />
                        <p id="seo-locale-help" className="text-xs text-muted-foreground">{t('seo.localeHint')}</p>
                        {fieldErrors.seo_locale && <p id="seo-locale-error" className="text-sm text-destructive-text">{fieldErrors.seo_locale}</p>}
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
                            ref={(node) => { fieldRefs.current.seo_og_image_url = node; }}
                            value={settings.seo_og_image_url}
                            onChange={(e) => handleChange('seo_og_image_url', e.target.value)}
                            placeholder={t('seo.ogImageUrlPlaceholder')}
                            maxLength={500}
                            type="text"
                            inputMode="url"
                            aria-invalid={!!fieldErrors.seo_og_image_url}
                            aria-describedby={describedBy('seo_og_image_url', 'seo-og-image-help')}
                        />
                        <p id="seo-og-image-help" className="text-xs text-muted-foreground">{t('seo.ogImageUrlHint')}</p>
                        {fieldErrors.seo_og_image_url && <p id="seo-og-image-url-error" className="text-sm text-destructive-text">{fieldErrors.seo_og_image_url}</p>}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
