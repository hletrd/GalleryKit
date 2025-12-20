'use client';

import Link from "next/link";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useState } from "react";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import siteConfig from "@/site-config.json";

interface NavClientProps {
    topics: { slug: string; label: string; image_filename?: string | null }[];
}

export function NavClient({ topics }: NavClientProps) {
    const pathname = usePathname();
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <nav className="sticky top-0 z-50 w-full bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 transition-all duration-300">
            <div className={cn(
                "container mx-auto flex items-center px-4 overflow-hidden transition-all duration-300",
                isExpanded ? "h-auto py-4 items-start" : "h-16"
            )}>
                <div className={cn("flex items-center mr-6 gap-4 shrink-0", isExpanded && "pt-1.5")}>
                    <Link href={siteConfig.home_link} className="flex items-center space-x-2 shrink-0">
                        <span className="font-bold text-xl tracking-tight">{siteConfig.nav_title}</span>
                    </Link>
                </div>

                <div className={cn(
                    "flex items-center gap-2 text-sm font-medium flex-1 min-w-0 transition-all duration-300",
                    // Mobile: Expanded vs Collapsed
                    isExpanded
                        ? "flex-wrap content-start"
                        : "overflow-x-auto scrollbar-hide mask-gradient-right pr-4",
                    // Desktop: Always right aligned, no mask if not overflowing (handled by padding/layout visually)
                    "md:ml-auto md:justify-end md:mask-none md:overflow-visible md:flex-wrap"
                )}>
                    {topics.map((topic) => {
                        const isActive = pathname === `/${topic.slug}`;
                        return (
                            <Link
                                key={topic.slug}
                                href={`/${topic.slug}`}
                                className={cn(
                                    "transition-all duration-200 flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0",
                                    isActive
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {topic.image_filename ? (
                                    <img
                                        src={`/resources/${topic.image_filename}`}
                                        alt={topic.label}
                                        className="w-6 h-6 object-cover rounded-full"
                                    />
                                ) : (
                                    topic.label
                                )}
                            </Link>
                        );
                    })}
                </div>

                {/* Mobile Expand Toggle */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn(
                        "ml-2 p-2 hover:bg-accent rounded-full md:hidden shrink-0",
                        isExpanded && "mt-1.5"
                    )}
                    aria-label={isExpanded ? "Collapse menu" : "Expand menu"}
                >
                    {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                    ) : (
                        <ChevronDown className="h-4 w-4" />
                    )}
                </button>
            </div>
            <style jsx global>{`
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </nav>
    );
}
