import type { Provider, ConnectionProvider } from "./types";
import { wordpress } from "./wordpress";
import { meta } from "./meta";
import { metaAds } from "./meta-ads";
import { googleAnalytics } from "./google-analytics";
import { searchConsole } from "./search-console";
import { pinterest } from "./pinterest";
import { semrush } from "./semrush";
import { gbp } from "./gbp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROVIDERS: Record<Provider, ConnectionProvider<any, any>> = { wordpress, meta, meta_ads: metaAds, google_analytics: googleAnalytics, search_console: searchConsole, pinterest, semrush, gbp };
/** Card order on the Connections tab. `gbp` is appended only when the feature flag is on (see connections page). */
export const PROVIDER_ORDER: Provider[] = ["wordpress", "meta", "meta_ads", "google_analytics", "search_console", "pinterest", "semrush"];
/** Providers that feed metrics_daily. */
export const METRIC_PROVIDERS: Provider[] = ["google_analytics", "search_console", "meta_ads"];

export * from "./types";
