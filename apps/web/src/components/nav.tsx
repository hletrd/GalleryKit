import { Suspense } from 'react';
import { getSeoSettings, getTopics } from "@/lib/data";
import { NavClient } from "./nav-client";

export async function Nav() {
    const [topics, seo] = await Promise.all([getTopics(), getSeoSettings()]);

    return (
        <Suspense>
            <NavClient topics={topics} navTitle={seo.nav_title} />
        </Suspense>
    );
}
