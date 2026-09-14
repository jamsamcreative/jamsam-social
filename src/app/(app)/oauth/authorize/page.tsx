import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabaseOauthStore } from "@/lib/oauth/store";
import { validateAuthorize, OauthError } from "@/lib/oauth/server";
import { ConsentForm } from "@/components/oauth/consent-form";

export const metadata = { title: "Connect" };

type Search = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const raw = {
    client_id: str(sp.client_id), redirect_uri: str(sp.redirect_uri), response_type: str(sp.response_type), code_challenge: str(sp.code_challenge),
    code_challenge_method: str(sp.code_challenge_method), state: str(sp.state), scope: str(sp.scope), resource: str(sp.resource),
  };
  const validated = await validateAuthorize(createSupabaseOauthStore(), raw).then(
    (v) => ({ ok: true as const, ...v }),
    (e: unknown) => ({ ok: false as const, error: e instanceof OauthError ? e.message : "Invalid authorization request" }),
  );
  if (!validated.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-2">
        <h1 className="text-2xl font-semibold">Can&apos;t connect</h1>
        <p className="text-sm text-destructive">{validated.error}</p>
      </div>
    );
  }
  const { client, params } = validated;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Connect {client.client_name ?? "this app"}</h1>
      <ConsentForm params={params} clientName={client.client_name ?? "This app"} email={user?.email ?? ""} />
    </div>
  );
}
