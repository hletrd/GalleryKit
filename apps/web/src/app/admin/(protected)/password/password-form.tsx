'use client';

import { useActionState } from "react";
import { updatePassword } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";



// Define explicit return type for the action to make TS happy
// or just cast initialState to any if we want to be lazy, but let's try to be correct.
// The action returns { error: string } | { success: boolean, message: string }
// We need a common supertype.

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

import { useTranslation } from "@/components/i18n-provider";

// ... (keep imports)

// ... (keep ActionState type and initialState)

export function PasswordForm() {
    const [state, formAction, isPending] = useActionState(updatePassword as any, startState);
    const { t } = useTranslation();

    return (
        <form action={formAction} className="space-y-4 max-w-md">
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

            <div className="space-y-2">
                <Label htmlFor="currentPassword">{t('password.current')}</Label>
                <Input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    required
                    placeholder={t('password.currentPlaceholder')}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="newPassword">{t('password.new')}</Label>
                <Input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    placeholder={t('password.newPlaceholder')}
                    minLength={8}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('password.confirm')}</Label>
                <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    placeholder={t('password.confirmPlaceholder')}
                    minLength={8}
                />
            </div>

            <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('password.submit')}
            </Button>
        </form>
    );
}
