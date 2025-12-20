'use client';

import Image, { ImageProps } from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface OptimisticImageProps extends ImageProps {
    fallbackSrc?: string;
}

export function OptimisticImage(props: OptimisticImageProps) {
    // Force remount when src changes to reset all state cleanly
    return <OptimisticImageInner key={props.src as string} {...props} />;
}

function OptimisticImageInner({ src, alt, className, ...props }: OptimisticImageProps) {
    const [imgSrc, setImgSrc] = useState(src);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    const handleError = () => {
        if (retryCount < 5) {
            // Exponential backoff: 500ms, 1000ms, 2000ms...
            const delay = 500 * Math.pow(2, retryCount);
            setTimeout(() => {
                setRetryCount(c => c + 1);
                // Add query param to bust browser cache
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
                    Image unavailable
                </div>
            )}
        </div>
    );
}
