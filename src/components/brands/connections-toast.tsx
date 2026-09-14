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
    const gbpOk = params.get("gbp_connected");
    const gbpErr = params.get("gbp_error");
    if (!ok && !err && !gbpOk && !gbpErr) return;
    if (ok) toast.success(`Connected ${ok}`);
    if (err) toast.error(err);
    if (gbpOk) toast.success(`Google connected: ${gbpOk} location${gbpOk === "1" ? "" : "s"} found. Tick the ones to post to and save.`);
    if (gbpErr) toast.error(gbpErr);
    router.replace(pathname);
  }, [params, router, pathname]);
  return null;
}
