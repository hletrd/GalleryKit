import { getTopics } from "@/lib/data";
import { NavClient } from "./nav-client";

export async function Nav() {
    const topics = await getTopics();

    return <NavClient topics={topics} />;
}
