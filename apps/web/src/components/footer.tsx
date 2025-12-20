import Link from "next/link";
import siteConfig from "@/site-config.json";

export function Footer() {
    return (
        <footer className="border-t py-6 md:py-0">
            <div className="container mx-auto px-4 flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
                <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                    {siteConfig.footer_text}
                </p>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <Link href="/admin" className="hover:underline">
                        Admin
                    </Link>
                </div>
            </div>
        </footer>
    );
}
