import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildHelperZip, HELPER_PLUGIN_PHP } from "@/lib/wordpress/helper-plugin";

describe("helper plugin", () => {
  it("zips the php under the plugin folder", async () => {
    const zip = await JSZip.loadAsync(await buildHelperZip());
    const file = zip.file("jamsam-connector/jamsam-connector.php");
    expect(file).toBeTruthy();
    expect(await file!.async("string")).toBe(HELPER_PLUGIN_PHP);
  });
  it("registers the three yoast keys and the ping route", () => {
    for (const k of ["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw", "jamsam/v1", "/ping"]) expect(HELPER_PLUGIN_PHP).toContain(k);
  });
});
