'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

type Messages = typeof enMessages;
type Locale = 'en' | 'ko';

interface I18nContextType {
    t: (key: string, args?: Record<string, string | number>) => string;
    locale: Locale;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocale] = useState<Locale>('en');
    const [messages, setMessages] = useState<Messages>(enMessages);

    useEffect(() => {
        const browserLocale = navigator.language;

        if (browserLocale.startsWith('ko')) {
            setLocale('ko');
            setMessages(koMessages);
        } else {
            setLocale('en');
            setMessages(enMessages);
        }

        document.documentElement.lang = browserLocale.startsWith('ko') ? 'ko' : 'en';
    }, []);

    const t = (key: string, args?: Record<string, string | number>): string => {
        const keys = key.split('.');
        let current: any = messages;
        for (const k of keys) {
            if (current[k] === undefined) {
                console.warn(`Translation missing for key: ${key}`);
                return key;
            }
            current = current[k];
        }

        let text = current as string;
        if (args) {
            Object.entries(args).forEach(([k, v]) => {
                text = text.replaceAll(`{${k}}`, String(v));
            });
        }
        return text;
    };

    // Always wrap with Provider so useContext works
    return (
        <I18nContext.Provider value={{ t, locale }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useTranslation() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useTranslation must be used within an I18nProvider');
    }
    return context;
}
