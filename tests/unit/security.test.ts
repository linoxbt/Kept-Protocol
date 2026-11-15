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

describe("rate-limit identity", () => {
  it("keys IPv6 on its /64, so rotating addresses inside a prefix does not reset limits", async () => {
    const { rateLimitIdentity } = await import("@/lib/http");
    expect(rateLimitIdentity("2001:db8:abcd:12:1::1")).toBe("2001:db8:abcd:12::/64");
    expect(rateLimitIdentity("2001:db8:abcd:12:ffff:ffff:ffff:ffff")).toBe("2001:db8:abcd:12::/64");
    expect(rateLimitIdentity("2001:0DB8:0000:0012::5")).toBe("2001:db8:0:12::/64");
    expect(rateLimitIdentity("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitIdentity("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(rateLimitIdentity("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitIdentity("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitIdentity("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("redirect targets", () => {
  it("accepts only paths on this site", async () => {
    const { safeRedirectPath } = await import("@/lib/http");
    expect(safeRedirectPath("/admin/extractions/kx_1?x=1", "/admin")).toBe("/admin/extractions/kx_1?x=1");
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "javascript:alert(1)", "evil", ""])
      expect(safeRedirectPath(bad, "/admin"), bad).toBe("/admin");
  });
});

describe("request bodies", () => {
  it("refuses bodies over the cap, declared or streamed", async () => {
    const { readCapped } = await import("@/lib/http");
    await expect(readCapped(new Request("https://k/x", { method: "POST", headers: { "content-length": "999999" }, body: "x" }), 1024)).rejects.toMatchObject({ status: 413 });
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(512)); c.close(); } });
    await expect(readCapped(new Request("https://k/x", { method: "POST", body: stream, duplex: "half" } as RequestInit), 1024)).rejects.toMatchObject({ status: 413 });
    expect(await readCapped(new Request("https://k/x", { method: "POST", body: "hello" }), 1024)).toBe("hello");
  });
});
