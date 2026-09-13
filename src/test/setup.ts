import { vi } from "vitest";

// `server-only` throws when imported outside a React Server Components environment.
// Tests import server modules directly, so neutralise the guard.
vi.mock("server-only", () => ({}));
