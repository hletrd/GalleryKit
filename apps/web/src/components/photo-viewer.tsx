'use client';

import { useState, useEffect, useCallback } from "react";
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
import { createPhotoShareLink } from '@/app/actions';
import { ImageZoom } from '@/components/image-zoom';
import { Lightbox, LightboxTrigger } from '@/components/lightbox';
import InfoBottomSheet from '@/components/info-bottom-sheet';
import { Histogram } from '@/components/histogram';

import { useRouter } from 'next/navigation';

interface PhotoViewerProps {
    images: any[];
    initialImageId: number;
    tags: any[];
    prevId?: number | null;
    nextId?: number | null;
}

function hasExifData(val: any): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (typeof val === 'number') return val > 0;
    return false;
}

export default function PhotoViewer({ images, initialImageId, prevId, nextId }: PhotoViewerProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const prefersReducedMotion = useReducedMotion();
    const [currentImageId, setCurrentImageId] = useState(initialImageId);
    const [timerShowInfo, setTimerShowInfo] = useState(true);
    const [isPinned, setIsPinned] = useState(false);
    const [showLightbox, setShowLightbox] = useState(false);
    const [showBottomSheet, setShowBottomSheet] = useState(false);

    // Find current image index and object
    const currentIndex = images.findIndex((img) => img.id === currentImageId);
    const image = images[currentIndex];

    // Derived state: visible if pinned OR if timer hasn't expired yet
    const showInfo = isPinned || timerShowInfo;
    const downloadFilename = image?.filename_original || image?.filename_jpeg;
    const downloadExt = downloadFilename ? downloadFilename.split('.').pop() || 'jpg' : 'jpg';
    const downloadHref = image?.filename_original
        ? `/uploads/original/${image.filename_original}`
        : (image?.filename_jpeg ? `/uploads/jpeg/${image.filename_jpeg}` : null);

    const navigate = useCallback((direction: number) => {
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < images.length) {
            setCurrentImageId(images[newIndex].id);
        } else {
            // Check for external prev/next logic (for single photo page)
            if (direction === -1 && prevId) {
                router.push(`/p/${prevId}`);
            } else if (direction === 1 && nextId) {
                router.push(`/p/${nextId}`);
            }
        }
    }, [currentIndex, images, prevId, nextId, router]);

    // Handle keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
    }, [navigate]);

    if (!image) return <div className="p-8 text-center">{t('home.noImages')}</div>;

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-8rem)] photo-viewer-container">
            <div className="flex items-center justify-between mb-4 photo-viewer-toolbar">
                <Link href={`/${image.topic}`}>
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

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                            try {
                                const result = await createPhotoShareLink(image.id);
                                if (result.success) {
                                    const url = `${window.location.origin}/s/${result.key}`;
                                    await navigator.clipboard.writeText(url);
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
                        className="gap-2 transition-all"
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
                <div className="relative flex items-center justify-center bg-black/5 rounded-xl border p-2 overflow-hidden min-h-[500px] group">
                    <PhotoNavigation
                        prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                        nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
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
                                    {(() => {
                                        const getAltText = (img: any) => {
                                            if (img.description && img.description.trim()) return img.description;
                                            if (img.title && img.title.trim() && !img.title.match(/\.[a-z0-9]{3,4}$/i)) return img.title;
                                            if (img.tags && img.tags.length > 0) return img.tags.map((t: any) => t.name).join(', ');
                                            return 'Photo';
                                        };
                                        // Extract base UUID from filename (e.g. "uuid.webp" -> "uuid")
                                        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                                        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                                        // If we don't have the filenames for some reason, fallback to basic Image
                                        if (!baseWebp || !baseAvif) {
                                            return (
                                                <Image
                                                    src={`/uploads/jpeg/${image.filename_jpeg}`}
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
                                                    srcSet={`/uploads/avif/${baseAvif}_640.avif 640w, /uploads/avif/${baseAvif}_1536.avif 1536w, /uploads/avif/${baseAvif}_2048.avif 2048w, /uploads/avif/${baseAvif}_4096.avif 4096w`}
                                                    sizes="(max-width: 640px) 100vw, (max-width: 1536px) 100vw, (max-width: 2048px) 100vw, 100vw"
                                                />
                                                <source
                                                    type="image/webp"
                                                    srcSet={`/uploads/webp/${baseWebp}_640.webp 640w, /uploads/webp/${baseWebp}_1536.webp 1536w, /uploads/webp/${baseWebp}_2048.webp 2048w, /uploads/webp/${baseWebp}_4096.webp 4096w`}
                                                    sizes="(max-width: 640px) 100vw, (max-width: 1536px) 100vw, (max-width: 2048px) 100vw, 100vw"
                                                />
                                                <img
                                                    src={`/uploads/jpeg/${image.filename_jpeg}`}
                                                    alt={getAltText(image)}
                                                    width={image.width}
                                                    height={image.height}
                                                    className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
                                                    decoding="sync"
                                                    loading="eager"
                                                />
                                            </picture>
                                        );
                                    })()}
                                </ImageZoom>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                    {(prevId != null || nextId != null) && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full z-10">
                            {currentIndex + 1} / {images.length}
                        </div>
                    )}
                </div>

                {/* Info Sidebar */}
                <div className={cn(
                    "space-y-6 transition-all duration-500 ease-in-out overflow-hidden transform",
                     showInfo ? "opacity-100 translate-x-0" : "opacity-0 translate-x-10 w-0 hidden lg:block lg:w-0 lg:p-0"
                )}>
                    {showInfo && (
                        <Card className="h-full border-none shadow-none bg-transparent lg:border lg:bg-card lg:shadow-sm">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline">{image.topic}</Badge>
                                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>{new Date(image.capture_date || '').toLocaleDateString()}</span>
                                </div>

                                {image.tags && image.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-4 mb-2">
                                        {image.tags.map((tag: any) => (
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
                                            ? image.tags.map((t: any) => `#${t.name}`).join(' ')
                                            : (image.user_filename || t('imageManager.untitled')))}
                                </CardTitle>
                                <CardDescription>{image.description || t('viewer.noDescription')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <h3 className="font-semibold mb-3 flex items-center gap-2"><Info className="h-4 w-4" /> {t('viewer.exifData')}</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                                    {hasExifData(image.camera_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.camera')}</p>
                                            <p className="font-medium truncate" title={image.camera_model}>{image.camera_model}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.lens_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.lens')}</p>
                                            <p className="font-medium truncate" title={image.lens_model}>{image.lens_model}</p>
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

                                                    // Should likely format as fraction if < 1
                                                    if (val < 1 && val > 0) {
                                                        const denominator = Math.round(1 / val);
                                                        // Check if it's close enough to a standard fraction
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
                                    {(image.latitude != null && image.longitude != null) && (
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
                                            imageUrl={`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}`}
                                            className="w-full"
                                        />
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4 text-sm mt-4">

                                    <div className="col-span-2">
                                        <p className="text-muted-foreground">{t('viewer.capturedAt')}</p>
                                        <p className="font-medium flex items-center gap-1" suppressHydrationWarning>
                                            <Calendar className="w-3 h-3" />
                                            {image.capture_date ? new Date(image.capture_date).toLocaleDateString() : 'Unknown'}
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
            />
        </div>
    );
}
