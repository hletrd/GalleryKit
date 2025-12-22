'use client';

import { useTranslation } from "@/components/i18n-provider";
import { PasswordForm } from "./password-form";

export function PasswordClient() {
    const { t } = useTranslation();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">{t('password.title')}</h1>
            <PasswordForm />
        </div>
    );
}
