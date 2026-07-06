'use client';

import { login } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { useTranslation } from '@/components/i18n-provider';
import { useRestoreFocusAfterPending } from '@/lib/use-restore-focus-after-pending';

const initialState = {
    error: '',
};

export function LoginForm() {
    const t = useTranslations('login');
    const serverT = useTranslations('serverActions');
    const { locale } = useTranslation();
    const [state, formAction, isPending] = useActionState(login, initialState);
    // F-13: track whether the password field is unmasked so users can verify
    // what they typed (especially relevant on mobile keyboards with
    // autocorrect). Default to masked.
    const [showPassword, setShowPassword] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
    const submitButtonRef = useRef<HTMLButtonElement>(null);
    useRestoreFocusAfterPending(submitButtonRef, isPending);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        const formData = new FormData(event.currentTarget);
        const nextErrors = {
            username: String(formData.get('username') ?? '').trim() ? undefined : serverT('usernameRequired'),
            password: String(formData.get('password') ?? '') ? undefined : serverT('passwordRequired'),
        };
        setFieldErrors(nextErrors);

        if (nextErrors.username || nextErrors.password) {
            event.preventDefault();
            const firstInvalid = event.currentTarget.querySelector<HTMLInputElement>(
                nextErrors.username ? '#login-username' : '#login-password'
            );
            firstInvalid?.focus();
        }
    };

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('title')}</h1>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-4">
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
                                aria-invalid={fieldErrors.username ? 'true' : undefined}
                                aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
                                autoFocus
                                autoComplete="username"
                                maxLength={64}
                            />
                            {fieldErrors.username && (
                                <p id="login-username-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.username}
                                </p>
                            )}
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
                                    aria-invalid={fieldErrors.password ? 'true' : undefined}
                                    aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                                    autoComplete="current-password"
                                    maxLength={1024}
                                    className="pr-11"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                            {fieldErrors.password && (
                                <p id="login-password-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.password}
                                </p>
                            )}
                        </div>
                        {state?.error && (
                            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text" role="alert" aria-live="assertive">
                                {state.error}
                            </p>
                        )}
                        <Button ref={submitButtonRef} type="submit" className="w-full h-11" disabled={isPending}>
                            {isPending ? t('submitting') : t('submit')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
