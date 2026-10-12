import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret, maskSecret } from "@/src/lib/secrets";

describe("secret encryption", () => {
  it("round-trips a value and never stores plaintext", () => {
    const encrypted = encryptSecret("sk-test-1234567890");

    expect(encrypted).not.toContain("sk-test");
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe("sk-test-1234567890");
  });

  it("uses a random IV so equal secrets encrypt differently", () => {
    expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"));
  });

  it("keeps legacy plaintext values readable", () => {
    expect(decryptSecret("legacy-plain-key")).toBe("legacy-plain-key");
  });

  it("returns null for tampered ciphertext", () => {
    const encrypted = encryptSecret("value-to-tamper") as string;
    const tampered = `${encrypted.slice(0, -4)}AAAA`;

    expect(decryptSecret(tampered)).toBeNull();
  });

  it("masks keys for display", () => {
    expect(maskSecret(encryptSecret("sk-abcdefghijklmnop"))).toBe("sk-a••••mnop");
    expect(maskSecret(null)).toBeNull();
  });
});
