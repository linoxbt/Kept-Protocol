/**
 * The live-breach demo, end to end, on real chain data. Kept never stages a breach against a real
 * team, so the demo uses its own clearly labelled token, team wallet and promise page.
 *
 *   npm run demo -- deploy    compile + deploy KDEMO, fund the demo team wallet with gas
 *   npm run demo -- seed      demo page + project + source + commitment (needs DATABASE_URL)
 *   npm run demo -- breach    the team wallet sends 4,000,000 KDEMO out (At risk, then Breached after finality)
 *   npm run demo -- rewrite   the page raises the allowance after the fact (Precedent + retroactive flag)
 *
 * Env: DEMO_CHAIN_ID (84532 Base Sepolia by default, 8453 Base), DEMO_DEPLOYER_KEY (funded),
 *      DEMO_TEAM_KEY (optional; generated on deploy), DEMO_TOKEN_ADDRESS, PUBLIC_BASE_URL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, parseEther, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const chainId = Number(process.env.DEMO_CHAIN_ID ?? 84532);
const chain = chainId === 8453 ? base : baseSepolia;
const rpc = process.env.DEMO_RPC_URL ?? (chainId === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org");
const pub = createPublicClient({ chain, transport: http(rpc) });
const SLUG = "kept-demo-labs";

const today = () => new Date().toISOString().slice(0, 10);
const human = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function page(team: string, token: string, start: string, allowance: string | null) {
  return `Kept Demo Labs is a fictional project that exists only to demonstrate Kept. Its token has no value.

Token: KDEMO at ${token} on ${chain.name}.

Team allocation. The team wallet ${team} holds 15,000,000 KDEMO.
${
  allowance
    ? `Team tokens are locked for 12 months from ${human(start)}. Up to ${allowance} team tokens may be released for market making before then.`
    : `Team tokens are locked for 12 months from ${human(start)}. No team tokens will be transferred out of the team wallet before then.`
}

Community. We will always put the community first.`;
}

function compile(): { abi: unknown[]; bytecode: Hex } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const solc = require("solc");
  const source = readFileSync(join(process.cwd(), "contracts/KeptDemoToken.sol"), "utf8");
  const out = JSON.parse(
    solc.compile(JSON.stringify({ language: "Solidity", sources: { "KeptDemoToken.sol": { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })),
  );
  if (out.errors?.some((e: { severity: string }) => e.severity === "error")) throw new Error(JSON.stringify(out.errors, null, 2));
  const c = out.contracts["KeptDemoToken.sol"].KeptDemoToken;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

async function deploy() {
  const deployer = privateKeyToAccount(need("DEMO_DEPLOYER_KEY") as Hex);
  const teamKey = (process.env.DEMO_TEAM_KEY as Hex | undefined) ?? generatePrivateKey();
  const team = privateKeyToAccount(teamKey);
  const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });
  const { abi, bytecode } = compile();
  console.log(`deploying KDEMO on ${chain.name} from ${deployer.address}…`);
  const hash = await wallet.deployContract({ abi, bytecode, args: [team.address, parseUnits("15000000", 18), deployer.address, parseUnits("85000000", 18)] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("deployment failed");
  const gas = await wallet.sendTransaction({ to: team.address, value: parseEther(process.env.DEMO_TEAM_GAS_ETH ?? "0.0002") });
  await pub.waitForTransactionReceipt({ hash: gas });
  console.log(`\nKDEMO deployed at ${receipt.contractAddress} (tx ${hash})\nteam wallet ${team.address} funded with gas\n`);
  console.log("Add to your environment:");
  console.log(`DEMO_CHAIN_ID=${chainId}\nDEMO_TOKEN_ADDRESS=${receipt.contractAddress}\nDEMO_TEAM_KEY=${teamKey}   # keep secret`);
}

async function seed() {
  const { db, closeDb } = await import("../src/db/client");
  const { createProject, addSource, captureForSource, storeSnapshot, getProjectBySlugOrId } = await import("../src/services/sources");
  const { createManualDraft, confirmDraft } = await import("../src/services/extractions");
  const { runCheck } = await import("../src/services/verify");
  const sql = db();
  const token = getAddress(need("DEMO_TOKEN_ADDRESS"));
  const team = privateKeyToAccount(need("DEMO_TEAM_KEY") as Hex).address;
  const start = process.env.DEMO_LOCK_START ?? today();
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const body = page(team, token, start, null);
  await sql`insert into demo_pages (slug, title, body) values (${SLUG}, 'Kept Demo Labs — tokenomics', ${body})
            on conflict (slug) do update set body = excluded.body, title = excluded.title, updated_at = now()`;
  let project = await getProjectBySlugOrId(SLUG, sql);
  project ??= await createProject({ name: "Kept Demo Labs", slug: SLUG, chainId, tokenAddress: token, isDemo: true, registrationLevel: "self", description: "Fictional, clearly labelled demo project. Its token, team wallet and promise page belong to Kept and exist only to demonstrate a live breach." }, sql);
  const source = await addSource({ projectId: project.id, url: `${base}/demo/${SLUG}`, kind: "demo" }, sql);
  const { snapshot } = await storeSnapshot(source.id, await captureForSource(source, sql), sql);
  const quote = `Team tokens are locked for 12 months from ${human(start)}. No team tokens will be transferred out of the team wallet before then.`;
  const ex = await createManualDraft(
    {
      snapshotId: snapshot.id,
      projectId: project.id,
      quote,
      fields: {
        category: "token_lock",
        responsible_entity: "Kept Demo Labs",
        token_symbol: "KDEMO",
        token_address: token,
        subjects: [{ address: team, role: "holder", label: "team wallet" }],
        comparator: "lte",
        amount: "0",
        amount_unit: "tokens",
        window_start: start,
        window_end: null,
        duration_months: 12,
        cliff_months: null,
        vesting_contract: null,
        derived: [],
        ambiguity_flags: [],
        condition_summary: `No KDEMO leaves the demo team wallet for 12 months from ${human(start)}.`,
      },
    },
    sql,
  );
  const { commitmentId } = await confirmDraft({ extractionId: ex.id, draftIndex: 0, reviewer: "demo-seed" }, sql);
  const r = await runCheck(commitmentId, { sql });
  console.log(`seeded ${commitmentId}: ${r.decision.status} — ${r.decision.reason}\nreceipt ${r.receipt.id}\nopen ${base}/commitments/${commitmentId}`);
  await closeDb();
}

async function breach() {
  const team = privateKeyToAccount(need("DEMO_TEAM_KEY") as Hex);
  const token = getAddress(need("DEMO_TOKEN_ADDRESS"));
  const to = (process.env.DEMO_BUYER as `0x${string}` | undefined) ?? privateKeyToAccount(need("DEMO_DEPLOYER_KEY") as Hex).address;
  const wallet = createWalletClient({ chain, transport: http(rpc), account: team });
  const hash = await wallet.writeContract({
    address: token,
    abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer",
    args: [to, parseUnits("4000000", 18)],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`team wallet sent 4,000,000 KDEMO to ${to} in block ${r.blockNumber}: ${hash}`);
  console.log("Kept shows At risk at the next check, and Breached once the block is finalized and a second provider confirms it.");
}

async function rewrite() {
  const { db, closeDb } = await import("../src/db/client");
  const sql = db();
  const token = getAddress(need("DEMO_TOKEN_ADDRESS"));
  const team = privateKeyToAccount(need("DEMO_TEAM_KEY") as Hex).address;
  const start = process.env.DEMO_LOCK_START ?? today();
  await sql`update demo_pages set body = ${page(team, token, start, "5,000,000")}, updated_at = now() where slug = ${SLUG}`;
  console.log("demo page rewritten: the allowance is now 5,000,000 KDEMO. Re-capture the source from the admin console (or wait for the watcher) to see the diff and the retroactive-revision flag.");
  await closeDb();
}

const cmd = process.argv[2];
const run = { deploy, seed, breach, rewrite }[cmd as "deploy"];
if (!run) {
  console.error("usage: npm run demo -- deploy | seed | breach | rewrite");
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
