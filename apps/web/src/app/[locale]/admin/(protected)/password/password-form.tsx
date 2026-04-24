'use client';

import { useActionState, useState } from "react";
import { updatePassword } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/components/i18n-provider";

type ActionState = {
    error?: string;
    success?: boolean;
    message?: string;
};

const startState: ActionState = {
    message: '',
    error: '',
    success: false
};

export function PasswordForm() {
    const [state, formAction, isPending] = useActionState(updatePassword, startState);
    const { t } = useTranslation();
    const [confirmError, setConfirmError] = useState<string | null>(null);

    const handleSubmit = (formData: FormData) => {
        const newPw = formData.get('newPassword') as string;
        const confirmPw = formData.get('confirmPassword') as string;
        if (newPw !== confirmPw) {
            setConfirmError(t('password.mismatch'));
            return;
        }
        setConfirmError(null);
        formAction(formData);
    };

    return (
        <form action={handleSubmit} className="space-y-4 max-w-md">
            {state?.error && (
                <Alert variant="destructive">
                    <AlertDescription>{state.error}</AlertDescription>
                </Alert>
            )}
            {state?.success && (
                <Alert className="bg-green-50 text-green-900 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800">
                    <AlertDescription>{state.message}</AlertDescription>
                </Alert>
            )}
            {confirmError && (
                <Alert variant="destructive">
                    <AlertDescription id="confirmPassword-error-summary">{confirmError}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="currentPassword">{t('password.current')}</Label>
                <Input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    required
                    maxLength={1024}
                    placeholder={t('password.current')}
                    autoComplete="current-password"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="newPassword">{t('password.new')}</Label>
                <Input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    placeholder={t('password.new')}
                    minLength={12}
                    maxLength={1024}
                    autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">{t('password.minLength')}</p>

            </div>

            <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('password.confirm')}</Label>
                <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    placeholder={t('password.confirm')}
                    minLength={12}
                    maxLength={1024}
                    autoComplete="new-password"
                    aria-invalid={confirmError ? 'true' : undefined}
                    aria-describedby={confirmError ? 'confirmPassword-error' : undefined}
                />
                {confirmError && (
                    <p id="confirmPassword-error" className="text-sm text-destructive">
                        {confirmError}
                    </p>
                )}
            </div>

            <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('password.submit')}
            </Button>
        </form>
    );
}
