import { describe, expect, it } from "vitest";
import { UnsafeUrlError, assertPublicUrl, isPrivateAddress } from "@/src/lib/safe-fetch";

describe("UT-04 SSRF protection", () => {
  it("UT-04.01 flags loopback addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
  });

  it("UT-04.02 flags private network addresses", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.5")).toBe(true);
    expect(isPrivateAddress("192.168.1.10")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });

  it("UT-04.03 flags link-local and metadata addresses", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("UT-04.04 allows public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("UT-04.05 rejects URLs on the local machine before any request is made", async () => {
    for (const url of ["http://localhost:3000/admin", "http://127.0.0.1/", "http://[::1]/"]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("UT-04.06 rejects the cloud metadata URL", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("UT-04.07 rejects URLs that are not HTTP or HTTPS", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/file"]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("UT-04.08 rejects URLs that contain a user name and password", async () => {
    await expect(assertPublicUrl("https://user:pass@example.com/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("UT-04.09 rejects text that is not a URL", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
