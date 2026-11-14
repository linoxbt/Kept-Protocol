import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { clientIpInfo } from "@/lib/http";
import { openValue, sealValue } from "@/lib/secrets";

const req = (h: Record<string, string>) => new Request("https://kept.test/x", { headers: h });

describe("client IP derivation", () => {
  afterEach(() => {
    delete process.env.KEPT_EDGE_TOKEN_SHA256;
    delete process.env.KEPT_EDGE_STRICT;
  });

  it("never trusts the client-written left-most X-Forwarded-For entry", () => {
    expect(clientIpInfo(req({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" })).ip).toBe("10.0.0.1");
    expect(clientIpInfo(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "203.0.113.9" }))).toEqual({ ip: "203.0.113.9", source: "real-ip" });
  });

  it("trusts the edge client IP only with the edge token once strict", () => {
    process.env.KEPT_EDGE_TOKEN_SHA256 = createHash("sha256").update("edge-secret").digest("hex");
    process.env.KEPT_EDGE_STRICT = "1";
    const base = { "x-real-ip": "198.51.100.7", "x-nf-client-connection-ip": "203.0.113.50" };
    expect(clientIpInfo(req({ ...base, "x-kept-edge": "edge-secret" }))).toEqual({ ip: "203.0.113.50", source: "edge" });
    expect(clientIpInfo(req({ ...base, "x-kept-edge": "wrong" }))).toEqual({ ip: "198.51.100.7", source: "real-ip" });
    expect(clientIpInfo(req(base))).toEqual({ ip: "198.51.100.7", source: "real-ip" });
  });

  it("accepts the unproven edge header before the edge is configured", () => {
    expect(clientIpInfo(req({ "x-real-ip": "198.51.100.7", "x-nf-client-connection-ip": "203.0.113.50" }))).toEqual({ ip: "203.0.113.50", source: "edge-unverified" });
  });
});

describe("secrets at rest", () => {
  afterEach(() => delete process.env.KEPT_SECRETS_KEK);

  it("passes values through without a KEK", () => {
    expect(sealValue("abc")).toBe("abc");
    expect(openValue("abc")).toBe("abc");
  });

  it("encrypts and authenticates with a KEK", () => {
    process.env.KEPT_SECRETS_KEK = "11".repeat(32);
    const sealed = sealValue("0xsecret");
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(sealed).not.toContain("0xsecret");
    expect(openValue(sealed)).toBe("0xsecret");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("00") ? "11" : "00");
    expect(() => openValue(tampered)).toThrow();
    process.env.KEPT_SECRETS_KEK = "22".repeat(32);
    expect(() => openValue(sealed)).toThrow();
    delete process.env.KEPT_SECRETS_KEK;
    expect(() => openValue(sealed)).toThrow(/KEPT_SECRETS_KEK/);
  });
});
