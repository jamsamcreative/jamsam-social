import type { Provider, ConnectionProvider } from "./types";
import { wordpress } from "./wordpress";
import { meta } from "./meta";
import { pinterest } from "./pinterest";
import { semrush } from "./semrush";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROVIDERS: Record<Provider, ConnectionProvider<any, any>> = { wordpress, meta, pinterest, semrush };
export const PROVIDER_ORDER: Provider[] = ["wordpress", "meta", "pinterest", "semrush"];

export * from "./types";
