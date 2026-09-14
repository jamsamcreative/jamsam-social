/** GA4 default channel groups that represent paid media. Everything else counts as earned/direct. */
export const PAID_CHANNELS = new Set(["Paid Search", "Paid Social", "Paid Video", "Paid Shopping", "Paid Other", "Display", "Cross-network"]);
export function isPaid(channel: string): boolean {
  return PAID_CHANNELS.has(channel);
}
/** Which GA4 channel each ad platform's clicks should land in, for the "arrived" % on the By-platform table. */
export const PLATFORM_CHANNEL = { meta: "Paid Social", google: "Paid Search" } as const;
