import { describe, expect, it } from "vitest";
import { UnsafeUrlError, assertPublicUrl, isPrivateAddress } from "@/src/lib/safe-fetch";

describe("SSRF protection", () => {
  it("flags private, loopback, link-local and metadata addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.5",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects unsafe URLs before any request is made", async () => {
    for (const url of [
      "http://localhost:3000/admin",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "file:///etc/passwd",
      "ftp://example.com/file",
      "https://user:pass@example.com/",
      "not a url",
    ]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });
});
