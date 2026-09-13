import { BrandSwitcher } from "./brand-switcher";
import { SignOutButton } from "./sign-out-button";
import type { Brand } from "@/lib/brands/queries";

export function Header({ brands, current, email }: { brands: Brand[]; current: string | null; email: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <BrandSwitcher brands={brands} current={current} />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
