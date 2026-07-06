'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';
import { Loader2 } from 'lucide-react';

interface OptimisticImageProps extends ImageProps {
    fallbackSrc?: string;
}

export function OptimisticImage(props: OptimisticImageProps) {
    // Force remount when src changes to reset all state cleanly
    return <OptimisticImageInner key={props.src as string} {...props} />;
}

function OptimisticImageInner({ src, alt, className, fallbackSrc, ...props }: OptimisticImageProps) {
    const { t } = useTranslation();
    const [imgSrc, setImgSrc] = useState(src);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    // CR3-02 / C3-24 (run-10 c3): the URL retries are built from. Starts as
    // the primary `src` prop and switches to `fallbackSrc` once the fallback
    // branch is taken, so retries target the CURRENTLY displayed source
    // instead of hammering the already-failed original.
    const retryBaseRef = useRef(src);

    // Clear retry timer on unmount
    useEffect(() => () => { clearTimeout(retryTimerRef.current); }, []);

    const handleError = () => {
        if (fallbackSrc && imgSrc !== fallbackSrc && retryBaseRef.current !== fallbackSrc) {
            setImgSrc(fallbackSrc);
            // CR3-02 / C3-24 (run-10 c3): once the fallback is taken it
            // becomes the retry BASE. The previous code reset the counter but
            // kept building retry URLs from the original `src` prop, so a
            // transiently-failing fallback got exactly one attempt while the
            // known-dead original burned all the retries.
            retryBaseRef.current = fallbackSrc;
            retryCountRef.current = 0;
            setRetryCount(0);
            setIsLoading(true);
            return;
        }

        const base = retryBaseRef.current;
        const isLocalUpload = typeof base === 'string' && base.startsWith('/uploads/');
        const maxRetries = isLocalUpload ? 1 : 5;
        if (retryCount < maxRetries) {
            const delay = Math.min(500 * Math.pow(2, retryCount), 15000);
            retryTimerRef.current = setTimeout(() => {
                const nextRetry = retryCountRef.current + 1;
                retryCountRef.current = nextRetry;
                setRetryCount(nextRetry);
                const separator = typeof base === 'string' && base.includes('?') ? '&' : '?';
                setImgSrc(`${base}${separator}retry=${nextRetry}`);
            }, delay);
        } else {
            setError(true);
            setIsLoading(false);
        }
    };

    return (
        <div className={cn("relative overflow-hidden", className)}>
            <Image
                {...props}
                src={imgSrc}
                alt={alt}
                className={cn(
                  "transition-opacity duration-300",
                  isLoading ? "opacity-0" : "opacity-100",
                  className
                )}
                onLoad={() => setIsLoading(false)}
                onError={handleError}
            />
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/20 animate-pulse" role="status" aria-live="polite" aria-label={t('common.loading')}>
                     <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
            )}
             {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs p-2 text-center" role="status" aria-live="polite">
                    {t('common.imageUnavailable')}
                </div>
            )}
        </div>
    );
}
