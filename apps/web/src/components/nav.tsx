import { Suspense } from 'react';
import { getSeoSettings, getTopics } from "@/lib/data";
import { NavClient } from "./nav-client";
import { getGalleryConfig } from '@/lib/gallery-config';

export async function Nav() {
    const [topics, seo, config] = await Promise.all([getTopics(), getSeoSettings(), getGalleryConfig()]);

    return (
        <Suspense>
            <NavClient topics={topics} navTitle={seo.nav_title} imageSizes={config.imageSizes} />
        </Suspense>
    );
}
