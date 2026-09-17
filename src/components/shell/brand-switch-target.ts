/** On a brand page, switching brands goes to the same sub-page for the new brand; elsewhere the page just re-renders. */
export function brandSwitchTarget(pathname: string, newSlug: string): string | null {
  const m = pathname.match(/^\/brands\/([^/]+)(\/.*)?$/);
  if (!m || m[1] === "new") return null;
  return `/brands/${newSlug}${m[2] ?? ""}`;
}
