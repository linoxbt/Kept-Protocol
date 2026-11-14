/**
 * The live demo, run by the worker on real chain data with the deployment's own operator key.
 * Kept never stages a breach against a real team: the demo uses Kept's own clearly labelled token
 * (KDEMO, no value), its own team wallet and its own promise page at /demo/kept-demo-labs.
 *
 * Stages, one per tick, each recorded so a restart resumes where it stopped:
 *   deploy   deploy KDEMO (15M to the demo team wallet, 85M to the operator) and fund the team wallet
 *   seed     publish the promise page, capture it, confirm the lock as v1, first check (Verified)
 *   breach   after DEMO_BREACH_DELAY_S, the team wallet sends 4,000,000 KDEMO out: At risk, then
 *            Breached once the block is final and a second provider confirms it
 *   rewrite  once Breached, the page is edited to allow 5,000,000 "for market making"; the change is
 *            captured and confirmed as v2, and Precedent flags the relaxation as retroactive
 *
 * Runs only when the operator is funded on DEMO_CHAIN_ID (default: the anchoring chain), and never
 * when KEPT_DEMO_AUTO=0. Nothing here touches any address other than Kept's own.
 */
import { createPublicClient, createWalletClient, getAddress, http, parseEther, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { openValue, sealValue } from "@/lib/secrets";
import artifact from "@/demo/kept-demo-token.json";
import { anchorChainId } from "./anchor";
import { confirmDraft, createManualDraft } from "./extractions";
import { confirmVersion } from "./precedent";
import { addSource, captureForSource, createProject, getProjectBySlugOrId, storeSnapshot, type SourceRow } from "./sources";

export const DEMO_SLUG = "kept-demo-labs";
const DEMO_LOCK = 7_310_002;
const MIN_DEPLOY_BALANCE = parseEther("0.00005");
const TEAM_GAS = parseEther("0.00002");

export interface DemoState {
  stage: "deployed" | "seeded" | "breached" | "done";
  chain_id: number;
  token: string;
  team: string;
  deploy_tx: string;
  start: string;
  seeded_at?: string;
  commitment_id?: string;
  breach_tx?: string;
  breached_at?: string;
  version_2?: number;
}

function demoChain() {
  const chainId = Number(process.env.DEMO_CHAIN_ID ?? anchorChainId());
  if (chainId === 8453) return { chainId, chain: base, rpc: env().BASE_RPC_URL };
  if (chainId === 84532) return { chainId, chain: baseSepolia, rpc: env().BASE_SEPOLIA_RPC_URL };
  throw new Error(`demo not supported on chain ${chainId}`);
}

const human = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function demoPage(team: string, token: string, chainName: string, start: string, allowance: string | null): string {
  return `Kept Demo Labs is a fictional project that exists only to demonstrate Kept. Its token has no value.

Token: KDEMO at ${token} on ${chainName}.

Team allocation. The team wallet ${team} holds 15,000,000 KDEMO.
${
  allowance
    ? `Team tokens are locked for 12 months from ${human(start)}. Up to ${allowance} team tokens may be released for market making before then.`
    : `Team tokens are locked for 12 months from ${human(start)}. No team tokens will be transferred out of the team wallet before then.`
}

Community. We will always put the community first.`;
}

async function readState(sql: Sql): Promise<DemoState | null> {
  const [r] = await sql<{ value: string }[]>`select value from kept_secrets where name = 'DEMO_STATE'`;
  return r ? (JSON.parse(openValue(r.value)) as DemoState) : null;
}

async function writeState(sql: Sql, s: DemoState): Promise<void> {
  await sql`insert into kept_secrets (name, value) values ('DEMO_STATE', ${JSON.stringify(s)})
            on conflict (name) do update set value = excluded.value`;
}

async function teamKey(sql: Sql): Promise<Hex> {
  await sql`insert into kept_secrets (name, value) values ('DEMO_TEAM_KEY', ${sealValue(generatePrivateKey())}) on conflict (name) do nothing`;
  const [r] = await sql<{ value: string }[]>`select value from kept_secrets where name = 'DEMO_TEAM_KEY'`;
  return openValue(r.value) as Hex;
}

export async function demoStatus(sql: Sql = db()): Promise<DemoState | null> {
  return readState(sql).catch(() => null);
}

/** Advances the demo by at most one stage. Never throws: the demo must not stop monitoring. */
export async function advanceDemo(sql: Sql = db()): Promise<{ stage: string; detail?: string }> {
  try {
    if (process.env.KEPT_DEMO_AUTO === "0") return { stage: "disabled" };
    const key = env().ANCHOR_PRIVATE_KEY as Hex | undefined;
    if (!key) return { stage: "waiting", detail: "no operator key" };
    const state = await readState(sql);
    if (state?.stage === "done") return { stage: "done" };
    const [lock] = await sql<{ ok: boolean }[]>`select pg_try_advisory_lock(${DEMO_LOCK}) as ok`;
    if (!lock.ok) return { stage: state?.stage ?? "none", detail: "another process is running the demo" };
    try {
      return await step(sql, key, state);
    } finally {
      await sql`select pg_advisory_unlock(${DEMO_LOCK})`;
    }
  } catch (e) {
    return { stage: "error", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

async function step(sql: Sql, key: Hex, state: DemoState | null): Promise<{ stage: string; detail?: string }> {
  const { chainId, chain, rpc } = demoChain();
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const operator = privateKeyToAccount(key);

  if (!state) {
    const balance = await pub.getBalance({ address: operator.address });
    if (balance < MIN_DEPLOY_BALANCE) return { stage: "waiting", detail: `fund the operator ${operator.address} on chain ${chainId}` };
    const team = privateKeyToAccount(await teamKey(sql));
    const wallet = createWalletClient({ chain, transport: http(rpc), account: operator });
    const deployTx = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode as Hex,
      args: [team.address, parseUnits("15000000", 18), operator.address, parseUnits("85000000", 18)],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: deployTx });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`demo token deployment ${deployTx} failed`);
    const gasTx = await wallet.sendTransaction({ to: team.address, value: TEAM_GAS });
    await pub.waitForTransactionReceipt({ hash: gasTx });
    await writeState(sql, { stage: "deployed", chain_id: chainId, token: receipt.contractAddress, team: team.address, deploy_tx: deployTx, start: new Date().toISOString().slice(0, 10) });
    return { stage: "deployed", detail: receipt.contractAddress };
  }

  if (state.stage === "deployed") {
    const site = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    if (!site) return { stage: "deployed", detail: "PUBLIC_BASE_URL is needed to publish the demo page" };
    const token = getAddress(state.token);
    const body = demoPage(state.team, token, chain.name, state.start, null);
    await sql`insert into demo_pages (slug, title, body) values (${DEMO_SLUG}, 'Kept Demo Labs — tokenomics', ${body})
              on conflict (slug) do update set body = excluded.body, title = excluded.title, updated_at = now()`;
    let project = await getProjectBySlugOrId(DEMO_SLUG, sql);
    project ??= await createProject(
      {
        name: "Kept Demo Labs",
        slug: DEMO_SLUG,
        chainId,
        tokenAddress: token,
        isDemo: true,
        registrationLevel: "self",
        description: "Fictional, clearly labelled demo project. Its token, team wallet and promise page belong to Kept and exist only to demonstrate a live breach on real chain data.",
      },
      sql,
    );
    // Retries after a failed tick reuse the source created the first time.
    const [existing] = await sql<SourceRow[]>`select * from sources where project_id = ${project.id} order by created_at limit 1`;
    const source = existing ?? (await addSource({ projectId: project.id, url: `${site}/demo/${DEMO_SLUG}`, kind: "demo" }, sql));
    const { snapshot } = await storeSnapshot(source.id, await captureForSource(source, sql), sql);
    const quote = `Team tokens are locked for 12 months from ${human(state.start)}. No team tokens will be transferred out of the team wallet before then.`;
    const ex = await createManualDraft({ snapshotId: snapshot.id, projectId: project.id, quote, fields: lockFields(token, state.team, state.start, "0") }, sql);
    const { commitmentId } = await confirmDraft({ extractionId: ex.id, draftIndex: 0, reviewer: "kept-demo" }, sql);
    await sql`update commitments set next_check_at = now(), check_interval_s = 600 where id = ${commitmentId}`;
    await writeState(sql, { ...state, stage: "seeded", seeded_at: new Date().toISOString(), commitment_id: commitmentId });
    return { stage: "seeded", detail: commitmentId };
  }

  if (state.stage === "seeded") {
    const delay = Number(process.env.DEMO_BREACH_DELAY_S ?? 1800) * 1000;
    if (Date.now() - Date.parse(state.seeded_at!) < delay) return { stage: "seeded", detail: "letting the first Verified receipts accumulate" };
    const team = privateKeyToAccount(await teamKey(sql));
    const wallet = createWalletClient({ chain, transport: http(rpc), account: team });
    const hash = await wallet.writeContract({
      address: getAddress(state.token),
      abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer",
      args: [operator.address, parseUnits("4000000", 18)],
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`demo transfer ${hash} failed`);
    await sql`update commitments set next_check_at = now() where id = ${state.commitment_id!}`;
    await writeState(sql, { ...state, stage: "breached", breach_tx: hash, breached_at: new Date().toISOString() });
    return { stage: "breached", detail: hash };
  }

  if (state.stage === "breached") {
    const [c] = await sql<{ status: string; final: boolean }[]>`select status, final from commitments where id = ${state.commitment_id!}`;
    if (c?.status !== "breached") return { stage: "breached", detail: `waiting for finality and confirmation (now ${c?.status})` };
    const token = getAddress(state.token);
    await sql`update demo_pages set body = ${demoPage(state.team, token, chain.name, state.start, "5,000,000")}, updated_at = now() where slug = ${DEMO_SLUG}`;
    const [src] = await sql<{ id: string }[]>`select s.id from sources s join projects p on p.id = s.project_id where p.slug = ${DEMO_SLUG} order by s.created_at limit 1`;
    const [source] = await sql`select * from sources where id = ${src.id}`;
    const { snapshot } = await storeSnapshot(src.id, await captureForSource(source as never, sql), sql);
    const quote = `Team tokens are locked for 12 months from ${human(state.start)}. Up to 5,000,000 team tokens may be released for market making before then.`;
    const [project] = await sql<{ id: string }[]>`select id from projects where slug = ${DEMO_SLUG}`;
    const ex = await createManualDraft(
      { snapshotId: snapshot.id, projectId: project.id, quote, fields: lockFields(token, state.team, state.start, "5000000"), targetCommitmentId: state.commitment_id },
      sql,
    );
    const v = await confirmVersion(state.commitment_id!, { extractionId: ex.id, draftIndex: 0, reviewer: "kept-demo", changeReason: "the project raised the allowance after the transfer" }, sql);
    await writeState(sql, { ...state, stage: "done", version_2: v.version });
    return { stage: "done", detail: `v${v.version}` };
  }
  return { stage: state.stage };
}

function lockFields(token: string, team: string, start: string, amount: string) {
  return {
    category: "token_lock",
    responsible_entity: "Kept Demo Labs",
    token_symbol: "KDEMO",
    token_address: token,
    subjects: [{ address: team, role: "holder", label: "team wallet" }],
    comparator: "lte",
    amount,
    amount_unit: "tokens",
    window_start: start,
    window_end: null,
    duration_months: 12,
    cliff_months: null,
    vesting_contract: null,
    derived: [],
    ambiguity_flags: [],
    condition_summary: amount === "0" ? "No KDEMO leaves the demo team wallet for 12 months." : `At most ${amount} KDEMO leaves the demo team wallet for 12 months.`,
  };
}
