import { notFound } from "next/navigation";
import { getBrandBySlug } from "@/lib/brands/queries";
import { getGuidelines } from "@/lib/guidelines/queries";
import { GUIDELINE_KINDS } from "@/lib/guidelines/kinds";
import { GuidelineEditor } from "@/components/brands/guideline-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandNav } from "../brand-nav";

export const metadata = { title: "Guidelines" };

export default async function GuidelinesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const docs = await getGuidelines(brand.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <BrandNav slug={brand.slug} />
      <Tabs defaultValue={GUIDELINE_KINDS[0].kind} className="max-w-4xl">
        <TabsList>
          {GUIDELINE_KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {k.label}
              {docs[k.kind].trim() === "" && <span className="ml-1 text-muted-foreground">·</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {GUIDELINE_KINDS.map((k) => (
          <TabsContent key={k.kind} value={k.kind} className="pt-4">
            <GuidelineEditor brandId={brand.id} kind={k.kind} initial={docs[k.kind]} description={k.description} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
