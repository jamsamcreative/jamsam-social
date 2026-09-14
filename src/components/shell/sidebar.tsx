"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/brands", label: "Brands" },
  { href: "/posts", label: "Posts" },
  { href: "/calendar", label: "Calendar" },
  { href: "/articles", label: "Articles" },
  { href: "/pins", label: "Pins" },
  { href: "/jobs", label: "Jobs" },
  { href: "/reports", label: "Reports" },
  { href: "/seo", label: "SEO" },
  { href: "/media", label: "Media" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="px-4 py-5">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          JamSam Social
        </Link>
        <p className="text-xs text-muted-foreground">JamSam Digital</p>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                active && "bg-muted text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
