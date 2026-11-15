import { describe, expect, it } from "vitest";
import { htmlToText, normalizeText } from "@/extraction/capture";

/** The original regex chain, kept here as the reference: the new code must match it byte for byte. */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
function referenceHtmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|header|footer|main|nav)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return normalizeText(s);
}

const PIECES = [
  "<", ">", "</", "/>", "<!--", "-->", "--", "!", "<script>", "</script>", "<SCRIPT type=x>", "</Script>", "<style>", "</style>",
  "<svg", "</svg>", "<svgx>", "<head>", "</head>", "<header>", "</header>", "<iframe>", "</iframe>", "<template>", "</template>",
  "<noscript>", "</noscript>", "<li>", "<li class=a>", "<LI", "</li>", "<br>", "<br/>", "<BR />", "<hr  >", "<p>", "</p>", "</DIV>",
  "<h2>", "</h2>", "&amp;", "&#39;", "&#x41;", "&nbsp;", "&bogus;", "&", ";", " ", "\n", "\t", "\r\n", "team", "tokens", "İ", "ſ", "K", "é", "😀", "​",
];

function randomHtml(rand: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(rand() * PIECES.length)];
  return s;
}

/** Small deterministic PRNG so failures reproduce. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("htmlToText", () => {
  it("matches the original regex chain byte for byte (content hashes stay stable)", () => {
    const rand = mulberry32(8453);
    for (let i = 0; i < 5000; i++) {
      const html = randomHtml(rand, 1 + Math.floor(rand() * 60));
      expect(htmlToText(html), JSON.stringify(html)).toBe(referenceHtmlToText(html));
    }
  });

  it("matches the original on a realistic page", () => {
    const page = `<!doctype html><html><head><title>X</title><style>p{}</style></head><body><header><nav><a href="/">Home</a></nav></header>
      <main><h1>Tokenomics</h1><!-- note --><p>Team tokens are <b>locked</b> for 12&nbsp;months.</p><ul><li>Cliff: 6 months</li><li class="x">Then linear</li></ul>
      <script>var a = "</p>";</script><svg><path d="M0"/></svg><br/>Contract: 0xabc &amp; more</main><footer>© 2026</footer></body></html>`;
    expect(htmlToText(page)).toBe(referenceHtmlToText(page));
  });

  it.each([
    ["unclosed comments", "<!--"],
    ["unclosed script tags", "<script"],
    ["unclosed head tags (prefix of <header>)", "<header"],
    ["unclosed list items", "<li"],
    ["bare angle brackets", "<"],
    ["br with whitespace", "<br    "],
  ])("stays linear on 10 MB of %s", (_name, unit) => {
    const html = unit.repeat(Math.ceil((10 * 1024 * 1024) / unit.length));
    const t = performance.now();
    htmlToText(html);
    // The original chain took hours here; linear code takes well under a second.
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
