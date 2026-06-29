import { Suspense } from 'react';
import { getSeoSettings, getTopicsCached } from "@/lib/data";
import { NavClient } from "./nav-client";
import { getGalleryConfig } from '@/lib/gallery-config';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';
import siteConfig from '@/site-config.json';

export async function Nav() {
    const [topics, seo, config] = await Promise.all([
        getTopicsCached().catch(() => []),
        getSeoSettings().catch(() => ({ nav_title: siteConfig.title })),
        getGalleryConfig().catch(() => ({
            imageSizes: DEFAULT_IMAGE_SIZES,
            semanticSearchMode: 'disabled',
        })),
    ]);

    return (
        <Suspense>
            <NavClient topics={topics} navTitle={seo.nav_title} imageSizes={config.imageSizes} semanticSearchMode={config.semanticSearchMode} />
        </Suspense>
    );
}
