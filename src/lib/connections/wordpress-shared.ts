import { z } from "zod";

export const wordpressConfigSchema = z.object({
  site_url: z.string().url("Enter the site URL, e.g. https://client.com"),
  username: z.string().min(1, "Username is required"),
});
export const wordpressSecretSchema = z.object({
  app_password: z.string().min(1, "Application password is required"),
});
export type WordpressConfig = z.infer<typeof wordpressConfigSchema>;
export type WordpressSecret = z.infer<typeof wordpressSecretSchema>;

export function wpBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

export function wpAuthHeader(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");
}
