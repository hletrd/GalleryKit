'use client';

import { useState, useTransition, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { createLrToken, revokeLrToken, listLrTokens, type LrTokenListItem } from '@/app/actions/lr-tokens';
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
    const { t } = useTranslation();
    const [tokens, setTokens] = useState<LrTokenListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const [showCreate, setShowCreate] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
    const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

    const fetchTokens = () => {
        startTransition(async () => {
            const result = await listLrTokens();
            if (Array.isArray(result)) {
                setTokens(result);
            } else {
                toast.error(result.error);
            }
            setLoading(false);
        });
    };

    useEffect(() => { fetchTokens(); }, []);

    const handleCreate = () => {
        if (!newLabel.trim()) {
            toast.error(t('lrToken.labelRequired'));
            return;
        }
        startTransition(async () => {
            const result = await createLrToken({
                label: newLabel.trim(),
                scopes: ['lr:upload', 'lr:read', 'lr:delete'],
            });
            if ('error' in result) {
                toast.error(result.error);
            } else {
                setCreatedPlaintext(result.plaintext);
                setShowCreate(false);
                setNewLabel('');
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
        navigator.clipboard.writeText(text).then(() => {
            toast.success(t('lrToken.copied'));
        }).catch(() => {
            toast.error(t('lrToken.copyFailed'));
        });
    };

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
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                                    {t('lrToken.created')}: {new Date(token.createdAt).toLocaleDateString()}
                                    {token.lastUsedAt && (
                                        <> &middot; {t('lrToken.lastUsed')}: {new Date(token.lastUsedAt).toLocaleDateString()}</>
                                    )}
                                    {token.expiresAt && (
                                        <> &middot; {t('lrToken.expires')}: {new Date(token.expiresAt).toLocaleDateString()}</>
                                    )}
                                </p>
                                <p className="text-xs text-muted-foreground">{token.scopes.join(', ')}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
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
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
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
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder={t('lrToken.labelPlaceholder')}
                            maxLength={128}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)} className="min-h-[44px]">
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={handleCreate} disabled={isPending} className="gap-2 min-h-[44px]">
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {t('lrToken.createButton')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Show plaintext once */}
            <Dialog open={!!createdPlaintext} onOpenChange={() => setCreatedPlaintext(null)}>
                <DialogContent>
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
                    <DialogFooter>
                        <Button onClick={() => setCreatedPlaintext(null)} className="min-h-[44px]">
                            {t('lrToken.plaintextDone')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revoke confirm dialog */}
            <Dialog open={confirmRevokeId !== null} onOpenChange={() => setConfirmRevokeId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('lrToken.revokeTitle')}</DialogTitle>
                        <DialogDescription>{t('lrToken.revokeDesc')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmRevokeId(null)} className="min-h-[44px]">
                            {t('common.cancel')}
                        </Button>
                        <Button
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
