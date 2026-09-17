"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BrandNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/brands/${slug}/settings`, label: "General" },
    { href: `/brands/${slug}/connections`, label: "Connections" },
    { href: `/brands/${slug}/guidelines`, label: "Guidelines" },
    { href: `/brands/${slug}/content-mix`, label: "Content mix" },
  ];
  return (
    <nav className="flex items-center gap-1 border-b">
      <Link href={`/brands/${slug}`} className="mr-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
        ← Dashboard
      </Link>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            pathname === t.href && "border-foreground text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
