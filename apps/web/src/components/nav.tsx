import { Suspense } from 'react';
import { buildSeoSettingsFallback, getSeoSettings, getTopicsCached } from "@/lib/data";
import { NavClient } from "./nav-client";
import { getGalleryConfig } from '@/lib/gallery-config';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';

export async function Nav() {
    const [topics, seo, config] = await Promise.all([
        getTopicsCached().catch(() => []),
        // C2-42 (ARCH-09, run-10 cycle-2): use the shared complete fallback
        // builder instead of an inline partial object defaulted from the
        // wrong siteConfig field (`title` instead of `nav_title`).
        getSeoSettings().catch(() => buildSeoSettingsFallback()),
        getGalleryConfig().catch(() => ({
            imageSizes: DEFAULT_IMAGE_SIZES,
            semanticSearchMode: 'disabled',
            showTimelineNav: true,
            showMapNav: true,
        })),
    ]);

    return (
        <Suspense>
            <NavClient
                topics={topics}
                navTitle={seo.nav_title}
                imageSizes={config.imageSizes}
                semanticSearchMode={config.semanticSearchMode}
                showTimelineNav={config.showTimelineNav}
                showMapNav={config.showMapNav}
            />
        </Suspense>
    );
}
