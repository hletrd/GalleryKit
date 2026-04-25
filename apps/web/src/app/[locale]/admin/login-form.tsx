'use client';

import { login } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useEffect } from 'react';

import { useTranslations } from 'next-intl';
import { useTranslation } from '@/components/i18n-provider';

const initialState = {
    error: '',
};

export function LoginForm() {
    const t = useTranslations('login');
    const { locale } = useTranslation();
    const [state, formAction, isPending] = useActionState(login, initialState);
    // F-13: track whether the password field is unmasked so users can verify
    // what they typed (especially relevant on mobile keyboards with
    // autocorrect). Default to masked.
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (state?.error) {
            toast.error(state.error);
        }
    }, [state]);

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('title')}</h1>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} className="space-y-4">
                        <input type="hidden" name="locale" value={locale} />
                        {/* F-12: persistent visible labels above each input
                            so the field identity stays visible after the user
                            tabs away and the placeholder disappears. */}
                        <div className="space-y-1">
                            <label htmlFor="login-username" className="text-sm font-medium block">
                                {t('username')}
                            </label>
                            <Input
                                id="login-username"
                                type="text"
                                name="username"
                                placeholder={t('username')}
                                required
                                autoFocus
                                autoComplete="username"
                                maxLength={64}
                            />
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="login-password" className="text-sm font-medium block">
                                {t('password')}
                            </label>
                            {/* F-13: password visibility toggle. Native
                                browser behavior keeps the input value
                                preserved when the `type` attribute flips
                                between `password` and `text`. */}
                            <div className="relative">
                                <Input
                                    id="login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    placeholder={t('password')}
                                    required
                                    autoComplete="current-password"
                                    maxLength={1024}
                                    className="pr-11"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                                    aria-pressed={showPassword}
                                    tabIndex={0}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                                    ) : (
                                        <Eye className="h-4 w-4" aria-hidden="true" />
                                    )}
                                </button>
                            </div>
                        </div>
                        {state?.error && (
                            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" aria-live="assertive">
                                {state.error}
                            </p>
                        )}
                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? t('submitting') : t('submit')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
