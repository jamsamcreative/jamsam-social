"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function ConnectionsToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const ok = params.get("meta_connected");
    const err = params.get("meta_error");
    if (!ok && !err) return;
    if (ok) toast.success(`Connected ${ok}`);
    if (err) toast.error(err);
    router.replace(pathname);
  }, [params, router, pathname]);
  return null;
}
