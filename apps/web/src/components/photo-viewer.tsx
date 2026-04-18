'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { ArrowLeft, Share2, Info, MapPin, Calendar, Clock, Download, PanelRightOpen, PanelRightClose } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { PhotoNavigation } from '@/components/photo-navigation';
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { createPhotoShareLink } from '@/app/actions';
import { ImageZoom } from '@/components/image-zoom';
import { Lightbox, LightboxTrigger } from '@/components/lightbox';
import InfoBottomSheet from '@/components/info-bottom-sheet';
import { Histogram } from '@/components/histogram';
import { ImageDetail, TagInfo, hasExifData, nu } from '@/lib/image-types';
import { imageUrl } from '@/lib/image-url';

import { useRouter } from 'next/navigation';
import siteConfig from '@/site-config.json';

interface PhotoViewerProps {
    images: ImageDetail[];
    initialImageId: number;
    tags: TagInfo[];
    prevId?: number | null;
    nextId?: number | null;
    canShare?: boolean;
}

export default function PhotoViewer({ images, initialImageId, prevId, nextId, canShare = false }: PhotoViewerProps) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const prefersReducedMotion = useReducedMotion();
    const [currentImageId, setCurrentImageId] = useState(initialImageId);
    const [timerShowInfo, setTimerShowInfo] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [showLightbox, setShowLightbox] = useState(() => {
        try { return sessionStorage.getItem('gallery_auto_lightbox') === 'true'; } catch { return false; }
    });
    const showLightboxRef = useRef(showLightbox);
    useEffect(() => { showLightboxRef.current = showLightbox; }, [showLightbox]);
    const [showBottomSheet, setShowBottomSheet] = useState(false);

    const currentIndex = images.findIndex((img) => img.id === currentImageId);
    const image = images[currentIndex];

    // Update document.title when navigating between photos
    useEffect(() => {
        if (image?.title) {
            document.title = `${image.title} — ${siteConfig.nav_title}`;
        }
    }, [image?.id, image?.title]);

    const showInfo = isPinned || timerShowInfo;
    const downloadFilename = image?.filename_jpeg;
    const downloadExt = downloadFilename ? downloadFilename.split('.').pop() || 'jpg' : 'jpg';
    const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;

    const navigate = useCallback((direction: number) => {
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < images.length) {
            setCurrentImageId(images[newIndex].id);
        } else {
            if (direction === -1 && prevId) {
                if (showLightboxRef.current) {
                    try { sessionStorage.setItem('gallery_auto_lightbox', 'true'); } catch {}
                }
                router.push(`/${locale}/p/${prevId}`);
            } else if (direction === 1 && nextId) {
                if (showLightboxRef.current) {
                    try { sessionStorage.setItem('gallery_auto_lightbox', 'true'); } catch {}
                }
                router.push(`/${locale}/p/${nextId}`);
            }
        }
    }, [currentIndex, images, locale, prevId, nextId, router]);

    // Clean up auto-lightbox flag after lazy init consumes it
    useEffect(() => {
        try { sessionStorage.removeItem('gallery_auto_lightbox'); } catch {}
    }, []);

    // Sync info state across breakpoints: mobile bottom sheet ↔ desktop sidebar
    useEffect(() => {
        const LG = 1024;
        const mql = window.matchMedia(`(min-width: ${LG}px)`);
        const handler = (e: MediaQueryListEvent) => {
            if (e.matches) {
                // Crossing into desktop: if bottom sheet is open, transfer to sidebar
                if (showBottomSheet) {
                    setShowBottomSheet(false);
                    setIsPinned(true);
                }
            } else {
                // Crossing into mobile: close sidebar (user can reopen via button)
                if (isPinned) {
                    setIsPinned(false);
                    setTimerShowInfo(false);
                }
            }
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [showBottomSheet, isPinned]);

    // Handle keyboard navigation (skip when lightbox is active — it handles its own keys)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (showLightbox) return;
            if (e.key === "ArrowLeft") {
                navigate(-1);
            } else if (e.key === "ArrowRight") {
                navigate(1);
            } else if (e.key === 'f' || e.key === 'F') {
                setShowLightbox(prev => !prev);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navigate, showLightbox]);

    if (!image) return <div className="p-8 text-center">{t('home.noImages')}</div>;

    const srcSetData = useMemo(() => {
        const getAltText = (img: ImageDetail) => {
            if (img.description && img.description.trim()) return img.description;
            if (img.title && img.title.trim() && !img.title.match(/\.[a-z0-9]{3,4}$/i)) return img.title;
            if (img.tags && img.tags.length > 0) return img.tags.map((t: TagInfo) => t.name).join(', ');
            return t('common.photo');
        };
        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

        if (!baseWebp || !baseAvif) {
            return (
                <Image
                    src={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
                    priority
                />
            );
        }

        return (
            <picture className="w-full h-full flex items-center justify-center">
                <source
                    type="image/avif"
                    srcSet={[640, 1536, 2048, 4096].map(w => `${imageUrl(`/uploads/avif/${baseAvif}_${w}.avif`)} ${w}w`).join(', ')}
                    sizes="(max-width: 640px) 100vw, (max-width: 1536px) 100vw, (max-width: 2048px) 100vw, 100vw"
                />
                <source
                    type="image/webp"
                    srcSet={[640, 1536, 2048, 4096].map(w => `${imageUrl(`/uploads/webp/${baseWebp}_${w}.webp`)} ${w}w`).join(', ')}
                    sizes="(max-width: 640px) 100vw, (max-width: 1536px) 100vw, (max-width: 2048px) 100vw, 100vw"
                />
                <img
                    src={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
                    decoding="sync"
                    loading="eager"
                />
            </picture>
        );
    }, [image.id, image.filename_webp, image.filename_avif, image.width]);

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-8rem)] photo-viewer-container">
            <div className="flex items-center justify-between mb-4 photo-viewer-toolbar">
                <Link href={`/${locale}/${image.topic}`}>
                    <Button variant="ghost" className="pl-0 gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        {t('viewer.backTo', { topic: image.topic_label || image.topic })}
                    </Button>
                </Link>

                <div className="flex gap-2">
                    <LightboxTrigger onClick={() => setShowLightbox(true)} />

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowBottomSheet(true)}
                        className="gap-2 lg:hidden"
                    >
                        <Info className="h-4 w-4" />
                        {t('viewer.info')}
                    </Button>

                    {canShare && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                            try {
                                const result = await createPhotoShareLink(image.id);
                                if (result.success) {
                                    const url = `${window.location.origin}/${locale}/s/${result.key}`;
                                    await copyToClipboard(url);
                                    toast.success(t('viewer.linkCopied'));
                                } else {
                                    toast.error(result.error || 'Failed to share');
                                }
                            } catch {
                                toast.error(t('viewer.errorSharing'));
                            }
                        }}
                        className="gap-2"
                    >
                        <Share2 className="h-4 w-4" />
                        {t('viewer.share')}
                    </Button>
                    )}

                    <Button
                        variant={isPinned ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            if (isPinned) {
                                setIsPinned(false);
                                setTimerShowInfo(false);
                            } else {
                                setIsPinned(true);
                            }
                        }}
                        className="gap-2 transition-all hidden lg:flex"
                    >
                        {isPinned ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                        {isPinned ? t('viewer.infoPinned') : t('viewer.info')}
                    </Button>
                </div>
            </div>

            <div className={cn(
                "grid gap-8 flex-1 transition-all duration-500 ease-in-out photo-viewer-grid",
                showInfo ? "grid-cols-1 lg:grid-cols-[1fr_350px]" : "grid-cols-1"
            )}>
                {/* Main Image Area */}
                <div className="relative flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl border p-2 overflow-hidden min-h-[500px] group">
                    <PhotoNavigation
                        prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                        nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
                        disabled={showLightbox}
                    />

                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={image.id}
                            initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, x: -20 }}
                            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                            className="w-full h-full flex items-center justify-center relative"
                        >
                            <div className="w-full h-full flex items-center justify-center">
                                <ImageZoom className="w-full h-full flex items-center justify-center">
                                    {srcSetData}
                                </ImageZoom>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                    {images.length > 1 && (
                        <div role="status" aria-live="polite" aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: images.length })} className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full z-10">
                            {currentIndex + 1} / {images.length}
                        </div>
                    )}
                </div>

                {/* Info Sidebar — hidden on mobile; only shown on lg+ via desktop pin/toggle */}
                <div className={cn(
                    "space-y-6 transition-all duration-500 ease-in-out overflow-hidden transform hidden lg:block",
                     showInfo ? "lg:opacity-100 lg:translate-x-0" : "lg:opacity-0 lg:translate-x-10 lg:w-0 lg:p-0"
                )}>
                    {showInfo && (
                        <Card className="h-full border-none shadow-none bg-transparent lg:border lg:bg-card lg:shadow-sm">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline">{image.topic}</Badge>
                                    {image.capture_date && <span className="text-xs text-muted-foreground" suppressHydrationWarning>{new Date(image.capture_date).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}</span>}
                                </div>

                                {image.tags && image.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-4 mb-2">
                                        {image.tags.map((tag: TagInfo) => (
                                            <Badge key={tag.slug} variant="secondary" className="text-xs">
                                                #{tag.name}
                                            </Badge>
                                        ))}
                                    </div>
                                )}

                                <CardTitle className="mt-2 text-2xl break-words">
                                    {image.title && image.title.trim() !== ''
                                        ? image.title
                                        : (image.tags && image.tags.length > 0
                                            ? image.tags.map((tag: TagInfo) => `#${tag.name.replace(/_/g, ' ')}`).join(' ')
                                            : t('imageManager.untitled'))}
                                </CardTitle>
                                <CardDescription>{image.description || t('viewer.noDescription')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <h3 className="font-semibold mb-3 flex items-center gap-2"><Info className="h-4 w-4" /> {t('viewer.exifData')}</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                                    {hasExifData(image.camera_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.camera')}</p>
                                            <p className="font-medium truncate" title={nu(image.camera_model)}>{image.camera_model}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.lens_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.lens')}</p>
                                            <p className="font-medium truncate" title={nu(image.lens_model)}>{image.lens_model}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.focal_length) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.focalLength')}</p>
                                            <p className="font-medium">{image.focal_length}mm</p>
                                        </div>
                                    )}
                                    {hasExifData(image.f_number) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.aperture')}</p>
                                            <p className="font-medium">f/{image.f_number}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_time) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.shutterSpeed')}</p>
                                            <p className="font-medium">
                                                {(() => {
                                                    const val = Number(image.exposure_time);
                                                    if (!Number.isFinite(val)) return image.exposure_time;

                                                    if (val < 1 && val > 0) {
                                                        const denominator = Math.round(1 / val);
                                                        if (Math.abs(1 / denominator - val) < 0.00001) {
                                                            return `1/${denominator}s`;
                                                        }
                                                    }
                                                    return `${image.exposure_time}s`;
                                                })()}
                                            </p>
                                        </div>
                                    )}
                                    {hasExifData(image.iso) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.iso')}</p>
                                            <p className="font-medium">{image.iso}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.color_space) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                            <p className="font-medium">
                                                {image.color_space}
                                                {image.color_space && image.color_space.toLowerCase().includes('p3') && (
                                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded gamut-p3-badge">
                                                        P3
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    )}
                                    {(image.width > 0 && image.height > 0) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.dimensions')}</p>
                                            <p className="font-medium">
                                                {image.width} × {image.height}
                                                <span className="text-muted-foreground text-xs ml-1">
                                                    ({(image.width * image.height / 1000000).toFixed(1)} MP)
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                    {hasExifData(image.original_format) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.format')}</p>
                                            <p className="font-medium">
                                                {image.original_format}
                                                {image.original_file_size && (
                                                    <span className="text-muted-foreground text-xs ml-1">
                                                        ({(image.original_file_size / (1024 * 1024)).toFixed(1)} MB)
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    )}
                                    {hasExifData(image.white_balance) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.whiteBalance')}</p>
                                            <p className="font-medium">{image.white_balance}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.metering_mode) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.meteringMode')}</p>
                                            <p className="font-medium">{image.metering_mode}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_compensation) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.exposureComp')}</p>
                                            <p className="font-medium">{image.exposure_compensation}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_program) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.exposureProgram')}</p>
                                            <p className="font-medium">{image.exposure_program}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.flash) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.flash')}</p>
                                            <p className="font-medium">{image.flash}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.bit_depth) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.bitDepth')}</p>
                                            <p className="font-medium">{image.bit_depth}-bit</p>
                                        </div>
                                    )}
                                    {(canShare && image.latitude != null && image.longitude != null) && (
                                        <div className="col-span-2">
                                             <p className="text-muted-foreground text-xs">{t('viewer.location')}</p>
                                             <a
                                                href={`https://www.google.com/maps/search/?api=1&query=${image.latitude},${image.longitude}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-primary hover:underline flex items-center gap-1"
                                             >
                                                <MapPin className="h-3 w-3" />
                                                {image.latitude.toFixed(4)}, {image.longitude.toFixed(4)}
                                             </a>
                                        </div>
                                    )}
                                </div>
                                {image.filename_jpeg && (
                                    <div className="mt-4 border-t pt-4">
                                        <Histogram
                                            imageUrl={imageUrl(`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}`)}
                                            className="w-full"
                                        />
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4 text-sm mt-4">

                                    <div className="col-span-2">
                                        <p className="text-muted-foreground">{t('viewer.capturedAt')}</p>
                                        <p className="font-medium flex items-center gap-1" suppressHydrationWarning>
                                            <Calendar className="w-3 h-3" />
                                            {image.capture_date ? new Date(image.capture_date).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : t('common.unknown')}
                                        </p>
                                        {image.capture_date && (
                                            <p className="font-medium flex items-center gap-1 text-xs text-muted-foreground mt-1" suppressHydrationWarning>
                                                <Clock className="w-3 h-3" />
                                                {new Date(image.capture_date).toLocaleTimeString()}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
                                {downloadHref && (
                                    <a
                                        href={downloadHref}
                                        download={`photo-${image.id}.${downloadExt}`}
                                        className="w-full"
                                    >
                                        <Button className="w-full gap-2">
                                            <Download className="h-4 w-4" /> {t('viewer.downloadOriginal')}
                                        </Button>
                                    </a>
                                )}
                            </CardFooter>
                        </Card>
                    )}
                </div>
            </div>

            {showLightbox && (
                <Lightbox
                    image={image}
                    prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                    nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
                    onClose={() => setShowLightbox(false)}
                    onNavigate={navigate}
                />
            )}

            <InfoBottomSheet
                image={image}
                isOpen={showBottomSheet}
                onClose={() => setShowBottomSheet(false)}
                isAdmin={canShare}
            />
        </div>
    );
}
