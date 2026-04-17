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

function OptimisticImageInner({ src, alt, className, ...props }: OptimisticImageProps) {
    const { t } = useTranslation();
    const [imgSrc, setImgSrc] = useState(src);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    // Clear retry timer on unmount
    useEffect(() => () => { clearTimeout(retryTimerRef.current); }, []);

    const handleError = () => {
        // Stop retrying immediately if we got a definitive 404 (image doesn't exist).
        // Only retry on network errors or 5xx (image may still be processing).
        if (retryCount < 5) {
            const delay = Math.min(500 * Math.pow(2, retryCount), 15000);
            retryTimerRef.current = setTimeout(() => {
                setRetryCount(c => c + 1);
                const separator = typeof src === 'string' && src.includes('?') ? '&' : '?';
                setImgSrc(`${src}${separator}retry=${retryCount + 1}`);
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
                <div className="absolute inset-0 flex items-center justify-center bg-muted/20 animate-pulse">
                     <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            )}
             {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs p-2 text-center">
                    {t('common.imageUnavailable')}
                </div>
            )}
        </div>
    );
}
