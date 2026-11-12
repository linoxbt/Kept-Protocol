/**
 * Integer token arithmetic. Amounts stay as bigint base units everywhere; decimals are
 * applied only for display. No floating point is ever used for an amount.
 */

export function toBaseUnits(amount: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new Error(`invalid decimal amount: ${amount}`);
  const whole = m[1];
  const frac = m[2] ?? "";
  if (frac.length > decimals) {
    // Reject rather than round: a promise that names more precision than the token has is ambiguous.
    throw new Error(`amount ${amount} has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: bigint, decimals: number, maxFraction = 4): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${frac ? "." + frac : ""}`;
}

export function sum(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

export function compare(value: bigint, comparator: "lte" | "gte" | "eq", threshold: bigint): boolean {
  switch (comparator) {
    case "lte":
      return value <= threshold;
    case "gte":
      return value >= threshold;
    case "eq":
      return value === threshold;
  }
}
