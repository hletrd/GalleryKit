'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { TagInput } from '@/components/tag-input';
import { useTranslation } from '@/components/i18n-provider';
import type { BulkUpdateImagesInput, LicenseTier, TriState } from '@/lib/bulk-edit-types';
import { LICENSE_TIERS } from '@/lib/bulk-edit-types';
type ApplyAltTarget = 'title' | 'description';
import { countCodePoints } from '@/lib/utils';

type FieldMode = 'leave' | 'set' | 'clear';

function ModeSelector({
    mode,
    onChange,
    label,
    canClear = true,
}: {
    mode: FieldMode;
    onChange: (m: FieldMode) => void;
    label: string;
    canClear?: boolean;
}) {
    const { t } = useTranslation();
    const options: FieldMode[] = canClear ? ['leave', 'set', 'clear'] : ['leave', 'set'];
    return (
        <Select value={mode} onValueChange={(v) => onChange(v as FieldMode)}>
            <SelectTrigger className="h-11 w-[140px]" aria-label={t('imageManager.bulkEditModeFor', { field: label })}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                        {t(`imageManager.bulkMode_${opt}`)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export interface BulkEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedIds: number[];
    availableTags: { id: number; name: string; slug: string }[];
    availableTopics: { slug: string; label: string }[];
    onSubmit: (input: BulkUpdateImagesInput) => Promise<void>;
}

export function BulkEditDialog({
    open,
    onOpenChange,
    selectedIds,
    availableTags,
    availableTopics,
    onSubmit,
}: BulkEditDialogProps) {
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    const [topicMode, setTopicMode] = useState<FieldMode>('leave');
    const [titleMode, setTitleMode] = useState<FieldMode>('leave');
    const [descMode, setDescMode] = useState<FieldMode>('leave');
    const [licenseMode, setLicenseMode] = useState<FieldMode>('leave');

    const [topicValue, setTopicValue] = useState('');
    const [titleValue, setTitleValue] = useState('');
    const [descValue, setDescValue] = useState('');
    const [licenseValue, setLicenseValue] = useState<LicenseTier>('none');
    const [addTagNames, setAddTagNames] = useState<string[]>([]);
    const [removeTagNames, setRemoveTagNames] = useState<string[]>([]);
    const [applyAltSuggested, setApplyAltSuggested] = useState<ApplyAltTarget | null>(null);

    const resetState = () => {
        setTopicMode('leave');
        setTitleMode('leave');
        setDescMode('leave');
        setLicenseMode('leave');
        setTopicValue('');
        setTitleValue('');
        setDescValue('');
        setLicenseValue('none');
        setAddTagNames([]);
        setRemoveTagNames([]);
        setApplyAltSuggested(null);
        setValidationError(null);
    };

    const handleClose = (nextOpen: boolean) => {
        if (!isSubmitting) {
            if (!nextOpen) resetState();
            onOpenChange(nextOpen);
        }
    };

    const handleSubmit = async () => {
        setValidationError(null);

        // Client-side validation
        if (titleMode === 'set' && countCodePoints(titleValue) > 255) {
            setValidationError(t('imageManager.titleTooLong'));
            return;
        }
        if (descMode === 'set' && countCodePoints(descValue) > 5000) {
            setValidationError(t('imageManager.descTooLong'));
            return;
        }
        if (topicMode === 'set' && !topicValue) {
            setValidationError(t('imageManager.bulkSelectTopic'));
            return;
        }

        const topicField: TriState<string> = topicMode === 'leave'
            ? { mode: 'leave' }
            : { mode: 'set', value: topicValue };

        const titleField: TriState<string> = titleMode === 'leave'
            ? { mode: 'leave' }
            : titleMode === 'set'
                ? { mode: 'set', value: titleValue }
                : { mode: 'clear' };

        const descField: TriState<string> = descMode === 'leave'
            ? { mode: 'leave' }
            : descMode === 'set'
                ? { mode: 'set', value: descValue }
                : { mode: 'clear' };

        const licenseField: TriState<LicenseTier> = licenseMode === 'leave'
            ? { mode: 'leave' }
            : { mode: 'set', value: licenseValue };

        const input: BulkUpdateImagesInput = {
            ids: selectedIds,
            topic: topicField,
            titlePrefix: titleField,
            description: descField,
            licenseTier: licenseField,
            addTagNames,
            removeTagNames,
            applyAltSuggested: applyAltSuggested ?? null,
        };

        setIsSubmitting(true);
        try {
            await onSubmit(input);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent closeLabel={t('aria.close')} className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('imageManager.bulkEditTitle', { count: selectedIds.length })}</DialogTitle>
                    <DialogDescription>{t('imageManager.bulkEditDesc')}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 py-2">
                    {/* Topic */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.topic')}</Label>
                        <div className="flex items-center gap-2">
                            <ModeSelector
                                mode={topicMode}
                                onChange={setTopicMode}
                                label={t('imageManager.topic')}
                                canClear={false}
                            />
                            {topicMode === 'set' && (
                                <Select value={topicValue} onValueChange={setTopicValue}>
                                    <SelectTrigger className="h-11 flex-1">
                                        <SelectValue placeholder={t('imageManager.bulkSelectTopic')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableTopics.map((tp) => (
                                            <SelectItem key={tp.slug} value={tp.slug}>
                                                {tp.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    {/* Title prefix */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.bulkTitlePrefix')}</Label>
                        <div className="flex items-center gap-2">
                            <ModeSelector
                                mode={titleMode}
                                onChange={setTitleMode}
                                label={t('imageManager.bulkTitlePrefix')}
                            />
                            {titleMode === 'set' && (
                                <Input
                                    className="h-11 flex-1"
                                    value={titleValue}
                                    onChange={(e) => setTitleValue(e.target.value)}
                                    placeholder={t('imageManager.bulkTitlePrefixPlaceholder')}
                                />
                            )}
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.descField')}</Label>
                        <div className="flex flex-col gap-2">
                            <ModeSelector
                                mode={descMode}
                                onChange={setDescMode}
                                label={t('imageManager.descField')}
                            />
                            {descMode === 'set' && (
                                <Textarea
                                    value={descValue}
                                    onChange={(e) => setDescValue(e.target.value)}
                                    placeholder={t('imageManager.descField')}
                                    rows={3}
                                />
                            )}
                        </div>
                    </div>

                    {/* License tier */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.bulkLicenseTier')}</Label>
                        <div className="flex items-center gap-2">
                            <ModeSelector
                                mode={licenseMode}
                                onChange={setLicenseMode}
                                label={t('imageManager.bulkLicenseTier')}
                                canClear={false}
                            />
                            {licenseMode === 'set' && (
                                <Select
                                    value={licenseValue}
                                    onValueChange={(v) => setLicenseValue(v as LicenseTier)}
                                >
                                    <SelectTrigger className="h-11 flex-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LICENSE_TIERS.map((tier) => (
                                            <SelectItem key={tier} value={tier}>
                                                {t(`imageManager.licenseTier_${tier}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    {/* Apply suggested alt text (US-P52) */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.bulkApplyAltSuggested')}</Label>
                        <Select
                            value={applyAltSuggested ?? 'none'}
                            onValueChange={(v) => setApplyAltSuggested(v === 'none' ? null : v as ApplyAltTarget)}
                        >
                            <SelectTrigger className="h-11 w-full" aria-label={t('imageManager.bulkApplyAltSuggested')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">{t('imageManager.bulkAltSuggested_none')}</SelectItem>
                                <SelectItem value="title">{t('imageManager.bulkAltSuggested_title')}</SelectItem>
                                <SelectItem value="description">{t('imageManager.bulkAltSuggested_description')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{t('imageManager.bulkApplyAltSuggestedHint')}</p>
                    </div>

                    {/* Add tags */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.bulkAddTags')}</Label>
                        <TagInput
                            availableTags={availableTags}
                            selectedTags={addTagNames}
                            onTagsChange={setAddTagNames}
                            placeholder={t('imageManager.addTag')}
                            ariaLabel={t('imageManager.bulkAddTags')}
                            className="w-full"
                        />
                    </div>

                    {/* Remove tags */}
                    <div className="space-y-2">
                        <Label>{t('imageManager.bulkRemoveTags')}</Label>
                        <TagInput
                            availableTags={availableTags}
                            selectedTags={removeTagNames}
                            onTagsChange={setRemoveTagNames}
                            placeholder={t('imageManager.addTag')}
                            ariaLabel={t('imageManager.bulkRemoveTags')}
                            className="w-full"
                        />
                    </div>

                    {validationError && (
                        <p className="text-sm text-destructive">{validationError}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => handleClose(false)}
                        disabled={isSubmitting}
                    >
                        {t('imageManager.cancel')}
                    </Button>
                    <Button
                        className="h-11"
                        onClick={() => void handleSubmit()}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? t('imageManager.saving') : t('imageManager.bulkEditApply')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
