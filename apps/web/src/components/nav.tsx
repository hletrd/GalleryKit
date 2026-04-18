import { Suspense } from 'react';
import { getTopics } from "@/lib/data";
import { NavClient } from "./nav-client";

export async function Nav() {
    const topics = await getTopics();

    return (
        <Suspense>
            <NavClient topics={topics} />
        </Suspense>
    );
}
