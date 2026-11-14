import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit millisecond time + 80 random bits, Crockford base32. Sortable and safe to expose. */
export function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let rand = "";
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(acc & 31n)] + rand;
    acc >>= 5n;
  }
  return time + rand;
}

export type IdPrefix = "kp" | "ks" | "kn" | "kx" | "kc" | "kv" | "kk" | "ke" | "kr" | "ka" | "ksc" | "kh" | "kg" | "kw" | "kpay" | "ksv" | "kd" | "kj";

export const newId = (prefix: IdPrefix) => `${prefix}_${ulid()}`;
