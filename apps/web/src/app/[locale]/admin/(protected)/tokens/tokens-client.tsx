'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { isImeComposingReactEvent } from '@/lib/ime';
import { copyToClipboard } from '@/lib/clipboard';
import { createLrToken, revokeLrToken, listLrTokens, type LrTokenListItem } from '@/app/actions/lr-tokens';
import { useRestoreFocusAfterPending } from '@/lib/use-restore-focus-after-pending';
import { Loader2, Plus, Trash2, Copy, Key } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

export function TokensClient() {
    const { t, locale } = useTranslation();
    const [tokens, setTokens] = useState<LrTokenListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [isPending, startTransition] = useTransition();
    const [showCreate, setShowCreate] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [labelError, setLabelError] = useState('');
    const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
    const [plaintextAcknowledged, setPlaintextAcknowledged] = useState(false);
    const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
    const labelErrorId = 'token-label-error';
    const loadErrorId = 'token-list-error';
    const retryButtonRef = useRef<HTMLButtonElement>(null);
    const createButtonRef = useRef<HTMLButtonElement>(null);
    const revokeConfirmButtonRef = useRef<HTMLButtonElement>(null);
    useRestoreFocusAfterPending(retryButtonRef, isPending);
    useRestoreFocusAfterPending(createButtonRef, isPending);
    useRestoreFocusAfterPending(revokeConfirmButtonRef, isPending);

    const loadTokens = async () => {
        const result = await listLrTokens();
        if (Array.isArray(result)) {
            setTokens(result);
            setLoadError('');
        } else {
            setLoadError(result.error);
            toast.error(result.error);
        }
        setLoading(false);
    };

    const fetchTokens = () => {
        setLoading(true);
        setLoadError('');
        startTransition(() => {
            void loadTokens();
        });
    };

    useEffect(() => {
        startTransition(() => {
            void loadTokens();
        });
    }, []);

    const handleCreate = () => {
        // R4C4 UX-R4C4-04: the Create button disables on isPending, but the
        // label input's Enter handler calls this directly — without this
        // guard, key-repeat (or a double Enter) while the server action is
        // in flight mints MULTIPLE live tokens and only the last plaintext
        // is ever shown. Mirrors the sibling pattern in image-manager.tsx /
        // topic-manager.tsx.
        if (isPending) return;
        if (!newLabel.trim()) {
            const error = t('lrToken.labelRequired');
            setLabelError(error);
            toast.error(error);
            return;
        }
        setLabelError('');
        startTransition(async () => {
            const result = await createLrToken({
                label: newLabel.trim(),
                scopes: ['lr:upload'],
            });
            if ('error' in result) {
                if (result.field === 'label') {
                    setLabelError(result.error);
                }
                toast.error(result.error);
            } else {
                setCreatedPlaintext(result.plaintext);
                setPlaintextAcknowledged(false);
                setShowCreate(false);
                setNewLabel('');
                setLabelError('');
                fetchTokens();
            }
        });
    };

    const handleRevoke = (id: number) => {
        startTransition(async () => {
            const result = await revokeLrToken(id);
            if ('error' in result) {
                toast.error(result.error);
            } else {
                toast.success(t('lrToken.revokeSuccess'));
                setConfirmRevokeId(null);
                fetchTokens();
            }
        });
    };

    const handleCopy = (text: string) => {
        copyToClipboard(text).then((copied) => {
            if (!copied) {
                toast.error(t('lrToken.copyFailed'));
                return;
            }
            setPlaintextAcknowledged(true);
            toast.success(t('lrToken.copied'));
        });
    };
    const formatTokenDate = (value: string | Date) => new Date(value).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button
                    onClick={() => setShowCreate(true)}
                    className="gap-2 min-h-[44px]"
                    aria-label={t('lrToken.generateButton')}
                >
                    <Plus className="h-4 w-4" />
                    {t('lrToken.generateButton')}
                </Button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">{t('lrToken.loading')}</span>
                </div>
            ) : loadError ? (
                <div id={loadErrorId} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                    <p className="text-destructive-text">{loadError}</p>
                    <Button
                        ref={retryButtonRef}
                        type="button"
                        variant="outline"
                        className="mt-3 min-h-[44px]"
                        onClick={fetchTokens}
                        disabled={isPending}
                    >
                        {t('common.tryAgain')}
                    </Button>
                </div>
            ) : tokens.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <Key className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t('lrToken.empty')}</p>
                </div>
            ) : (
                <div className="divide-y rounded-lg border">
                    {tokens.map((token) => (
                        <div key={token.id} className="flex items-center justify-between gap-4 px-4 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-medium text-sm">{token.label}</p>
                                <p className="text-xs text-muted-foreground">
                                    {t('lrToken.created')}: {formatTokenDate(token.createdAt)}
                                    {token.lastUsedAt && (
                                        <> &middot; {t('lrToken.lastUsed')}: {formatTokenDate(token.lastUsedAt)}</>
                                    )}
                                    <> &middot; {t('lrToken.expires')}: {token.expiresAt ? formatTokenDate(token.expiresAt) : t('lrToken.neverExpires')}</>
                                </p>
                                <p className="text-xs text-muted-foreground">{token.scopes.join(', ')}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 text-destructive-text hover:text-destructive-text"
                                onClick={() => setConfirmRevokeId(token.id)}
                                aria-label={t('lrToken.revokeAria', { label: token.label })}
                                disabled={isPending}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {/* Create dialog */}
            <Dialog
                open={showCreate}
                onOpenChange={(open) => {
                    setShowCreate(open);
                    if (!open) setLabelError('');
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('lrToken.createTitle')}</DialogTitle>
                        <DialogDescription>{t('lrToken.createDesc')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label htmlFor="token-label">{t('lrToken.labelField')}</Label>
                        <Input
                            id="token-label"
                            value={newLabel}
                            onChange={(e) => {
                                setNewLabel(e.target.value);
                                if (labelError) setLabelError('');
                            }}
                            placeholder={t('lrToken.labelPlaceholder')}
                            maxLength={256}
                            aria-invalid={!!labelError}
                            aria-describedby={labelError ? labelErrorId : undefined}
                            // R4C6 COR-R4C6-01: the IME composition-commit Enter
                            // must not create a token with a half-composed label.
                            onKeyDown={(e) => { if (isImeComposingReactEvent(e)) return; if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                        />
                        {labelError && (
                            <p id={labelErrorId} role="alert" className="text-sm text-destructive-text">
                                {labelError}
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)} className="min-h-[44px]">
                            {t('common.cancel')}
                        </Button>
                        <Button ref={createButtonRef} onClick={handleCreate} disabled={isPending} className="gap-2 min-h-[44px]">
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {t('lrToken.createButton')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Show plaintext once */}
            <Dialog
                open={!!createdPlaintext}
                onOpenChange={(open) => {
                    if (!open && plaintextAcknowledged) {
                        setCreatedPlaintext(null);
                        setPlaintextAcknowledged(false);
                    }
                }}
            >
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>{t('lrToken.plaintextTitle')}</DialogTitle>
                        <DialogDescription>{t('lrToken.plaintextDesc')}</DialogDescription>
                    </DialogHeader>
                    <div className="my-2 flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-muted px-3 py-2 text-xs font-mono select-all">
                            {createdPlaintext}
                        </code>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => handleCopy(createdPlaintext ?? '')}
                            aria-label={t('lrToken.copyAria')}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                    <label className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm">
                        <input
                            type="checkbox"
                            checked={plaintextAcknowledged}
                            onChange={(event) => setPlaintextAcknowledged(event.target.checked)}
                            className="h-4 w-4"
                        />
                        <span>{t('lrToken.plaintextAcknowledge')}</span>
                    </label>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setCreatedPlaintext(null);
                                setPlaintextAcknowledged(false);
                            }}
                            disabled={!plaintextAcknowledged}
                            className="min-h-[44px]"
                        >
                            {t('lrToken.plaintextDone')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revoke confirm dialog */}
            <Dialog open={confirmRevokeId !== null} onOpenChange={(open) => { if (!open && !isPending) setConfirmRevokeId(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('lrToken.revokeTitle')}</DialogTitle>
                        <DialogDescription>{t('lrToken.revokeDesc')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmRevokeId(null)} disabled={isPending} className="min-h-[44px]">
                            {t('common.cancel')}
                        </Button>
                        <Button
                            ref={revokeConfirmButtonRef}
                            variant="destructive"
                            onClick={() => confirmRevokeId !== null && handleRevoke(confirmRevokeId)}
                            disabled={isPending}
                            className="min-h-[44px]"
                        >
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('lrToken.revokeButton')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
