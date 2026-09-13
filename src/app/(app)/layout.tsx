import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [brands, current] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const currentValid = brands.some((b) => b.slug === current) ? current : (brands[0]?.slug ?? null);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header brands={brands} current={currentValid} email={user.email ?? ""} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
