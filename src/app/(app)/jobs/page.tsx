import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listJobsForBrand } from "@/lib/jobs/queries";
import { JobsTable } from "@/components/jobs/jobs-table";

export const metadata = { title: "Jobs" };
export const maxDuration = 300;

export default async function JobsPage() {
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <p className="text-muted-foreground">
        Create a brand first.{" "}
        <Link className="underline" href="/brands/new">
          New brand
        </Link>
      </p>
    );
  }
  const jobs = await listJobsForBrand(brand.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Generation jobs</h1>
        <p className="text-sm text-muted-foreground">{brand.name}. In-app jobs run automatically; MCP jobs wait for an external Claude session (see Settings).</p>
      </div>
      <JobsTable jobs={jobs} timezone={brand.timezone} />
    </div>
  );
}
