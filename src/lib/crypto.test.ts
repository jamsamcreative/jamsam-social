import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a JSON object", () => {
    const ct = encryptJson({ app_password: "abcd efgh" });
    expect(decryptJson<{ app_password: string }>(ct)).toEqual({ app_password: "abcd efgh" });
  });
  it("produces different ciphertext for the same input (random IV)", () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });
  it("throws on tampered ciphertext", () => {
    const ct = encryptJson({ a: 1 });
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptJson(buf.toString("base64"))).toThrow();
  });
});
