// The check of a new prompt version against the agreement check's stronger model. Run from
// the root, `old` first:
//
//   npx deno run --node-modules-dir=none --no-lock --allow-run=node --allow-read \
//     --allow-write --allow-env --allow-net=api.anthropic.com scripts/theme-probe-v2.ts old
//   npx deno run ... scripts/theme-probe-v2.ts new
//   npx deno run ... scripts/theme-probe-v2.ts report
//
// `old` reads the 300 reviews of sample.json with the working model and the new prompt, and
// compares with the stronger model's saved labels. Those were written under the old prompt
// and the new boundaries were drawn from them, so this number flatters.
//
// `new` draws reviews the first sample never touched. The working model reads them under
// both prompts, then the stronger one under the new prompt, last, because it is the one that
// costs: it goes on in shuffled order until the ceiling, and the comparison takes what it read.
//
// The ceiling counts what the earlier checks spent. The key is read from
// ~/.str-ops/anthropic-probe-key.txt and never printed. Texts live in this process only;
// v2.json holds numbers and theme codes. The old prompt is prompt-v1.txt beside it.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { join } from "node:path";

import { MODEL_ID } from "../supabase/functions/_shared/signals/classify.ts";
import { hasUsableName } from "../supabase/functions/_shared/signals/redact.ts";
import {
  agreementOf,
  type AgreementRow,
  type Band,
  bandOf,
  drawSample,
  PROBE_SEED,
  type ProbeRow,
  shuffled,
} from "../supabase/functions/_shared/signals/theme-probe.ts";
import type { IssueTheme } from "../supabase/functions/_shared/signals/themes.ts";
import {
  parseThemes,
  renderThemeInput,
  type ThemeInput,
  THEMES_MAX_TOKENS,
  THEMES_SCHEMA,
  THEMES_SYSTEM_PROMPT,
} from "../supabase/functions/_shared/signals/themes-read.ts";
import { bookingNames, companyNames, PROBE_DIR, publicReviews, redactedInput, SAMPLE_FILE } from "./theme-probe.ts";

const HOME = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
const KEY_FILE = join(HOME, ".str-ops", "anthropic-probe-key.txt");
const AGREEMENT_FILE = join(PROBE_DIR, "agreement.json");
const PROMPT_V1_FILE = join(PROBE_DIR, "prompt-v1.txt");
const V2_FILE = join(PROBE_DIR, "v2.json");

const REFERENCE_MODEL = "claude-opus-5-5";
/** The owner's ceiling: one dollar on top of the first probe. */
const CEILING_MICRO_USD = 1_072_547;
const NEW_SAMPLE = 100;
const NEW_SEED = PROBE_SEED + 60;
const MIN_CONFIDENCE = 0.6;
const CONCURRENCY = 4;
/** What one more call of the stronger model may cost at most. */
const REFERENCE_MARGIN_MICRO_USD = 6_000;
/** Fewer calls in flight on the costly model: less held back from the ceiling. */
const REFERENCE_CONCURRENCY = 2;
const WORKING_MARGIN_MICRO_USD = 1_100;

interface Price {
  readonly input: number;
  readonly write: number;
  readonly read: number;
  readonly output: number;
}

/** Read on 2026-11-06, in millionths of a dollar per token. */
const PRICES: Readonly<Record<string, Price>> = {
  [REFERENCE_MODEL]: { input: 4, write: 5, read: 0.2, output: 20 },
  [MODEL_ID]: { input: 0.1, write: 0.125, read: 0.01, output: 0.5 },
};

interface Ledger {
  spent: number;
  failed: number;
}

interface Saved {
  /** Everything spent on the key so far, this script's calls included. */
  spent: number;
  old?: { rows: AgreementRow[]; failed: number; spent: number };
  fresh?: {
    read: number;
    failed: number;
    spent: number;
    population: Record<Band, number>;
    rows: { n: number; band: Band; v1: IssueTheme[]; v2: IssueTheme[]; reference: IssueTheme[] }[];
  };
}

async function loadSaved(): Promise<Saved> {
  const text = await Deno.readTextFile(V2_FILE).catch(() => "");
  if (text !== "") {
    return JSON.parse(text) as Saved;
  }
  const { spent: first } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as { spent: number };
  const { spent: second } = JSON.parse(await Deno.readTextFile(AGREEMENT_FILE)) as { spent: number };
  return { spent: first + second };
}

function clientOf(key: string): Anthropic {
  return new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", authToken: null, timeout: 60_000, maxRetries: 0 });
}

/** One reading: the labels the panel would keep, or null when the call failed. */
async function readThemes(
  client: Anthropic,
  model: string,
  prompt: string,
  input: ThemeInput,
  ledger: Ledger,
): Promise<IssueTheme[] | null> {
  const price = PRICES[model];
  try {
    const response = await client.messages.create({
      model,
      max_tokens: THEMES_MAX_TOKENS,
      system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderThemeInput(input) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: THEMES_SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const usage = response.usage;
    ledger.spent += Math.ceil(
      usage.input_tokens * price.input + (usage.cache_creation_input_tokens ?? 0) * price.write +
        (usage.cache_read_input_tokens ?? 0) * price.read + usage.output_tokens * price.output,
    );
    const block = response.content.find((part) => part.type === "text");
    const raw = JSON.parse(block !== undefined && block.type === "text" ? block.text : "{}");
    return parseThemes(raw).labels.filter((label) => label.confidence >= MIN_CONFIDENCE).map((label) => label.theme);
  } catch (error: unknown) {
    ledger.failed += 1;
    ledger.spent += model === REFERENCE_MODEL ? REFERENCE_MARGIN_MICRO_USD : WORKING_MARGIN_MICRO_USD;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error(`The key was refused: ${error.status}`);
      Deno.exit(3);
    }
    return null;
  }
}

/** Runs `work` over `items`, the first alone so the others find the cache, until `canGo` says no. */
async function eachOf<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  canGo: () => boolean,
  concurrency = CONCURRENCY,
): Promise<void> {
  let next = 0;
  if (items.length > 0 && canGo()) {
    await work(items[next++]);
  }
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length && canGo()) {
      await work(items[next++]);
    }
  }));
}

async function readKey(): Promise<string> {
  const key = (await Deno.readTextFile(KEY_FILE).catch(() => "")).trim();
  if (key === "") {
    console.error("The key file is empty.");
    Deno.exit(2);
  }
  return key;
}

async function source() {
  const today = new Date().toISOString().slice(0, 10);
  const reviews = await publicReviews(today);
  const names = await bookingNames(today);
  const company = await companyNames();
  const guestOf = (review: (typeof reviews)[number]): string[] => [
    ...review.guestNames,
    ...(names.get(review.row.external_reservation_id ?? "") ?? []),
  ];
  return { reviews, company, guestOf };
}

async function readOld(): Promise<void> {
  const saved = await loadSaved();
  if (saved.old !== undefined) {
    console.error("The old sample is read already.");
    Deno.exit(2);
  }
  const key = await readKey();
  const { rows } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as { rows: ProbeRow[] };
  const { rows: reference } = JSON.parse(await Deno.readTextFile(AGREEMENT_FILE)) as { rows: AgreementRow[] };
  const { reviews, company, guestOf } = await source();
  const byId = new Map(reviews.map((review) => [review.row.external_id, review]));
  const byN = new Map(rows.map((row) => [row.n, row]));
  const client = clientOf(key);
  const ledger: Ledger = { spent: 0, failed: 0 };
  const done: AgreementRow[] = [];

  await eachOf(reference, async (row) => {
    const review = byId.get(byN.get(row.n)?.reviewId ?? "");
    if (review === undefined || !hasUsableName(guestOf(review))) {
      ledger.failed += 1;
      return;
    }
    const themes = await readThemes(client, MODEL_ID, THEMES_SYSTEM_PROMPT, redactedInput(review, guestOf(review), company), ledger);
    if (themes !== null) {
      done.push({ ...row, working: themes });
    }
  }, () => saved.spent + ledger.spent + CONCURRENCY * WORKING_MARGIN_MICRO_USD <= CEILING_MICRO_USD);

  const next: Saved = {
    ...saved,
    spent: saved.spent + ledger.spent,
    old: { rows: done, failed: ledger.failed, spent: ledger.spent },
  };
  await Deno.writeTextFile(V2_FILE, JSON.stringify(next));
  console.log(JSON.stringify({ read: done.length, failed: ledger.failed, spent_usd: ledger.spent / 1e6, total_usd: next.spent / 1e6 }));
}

async function readNew(): Promise<void> {
  const saved = await loadSaved();
  if (saved.old === undefined || saved.fresh !== undefined) {
    console.error("`old` comes first, and `new` runs once.");
    Deno.exit(2);
  }
  const key = await readKey();
  const promptV1 = await Deno.readTextFile(PROMPT_V1_FILE);
  const { rows: first } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as { rows: ProbeRow[] };
  const { reviews, company, guestOf } = await source();
  const seen = new Set(first.map((row) => row.reviewId));
  const usable = reviews.filter((review) => hasUsableName(guestOf(review)));
  const population: Record<Band, number> = { low: 0, mid: 0, high: 0 };
  for (const review of usable) {
    population[bandOf(review.row.rating)] += 1;
  }
  const others = usable.filter((review) => !seen.has(review.row.external_id));
  const perBand = Math.ceil(NEW_SAMPLE / 3);
  const sample = shuffled(drawSample(others, (review) => review.row.rating, perBand, NEW_SEED), NEW_SEED + 7).slice(0, NEW_SAMPLE);
  const client = clientOf(key);
  const ledger: Ledger = { spent: 0, failed: 0 };
  const roomFor = (margin: number, inFlight: number) => () => saved.spent + ledger.spent + inFlight * margin <= CEILING_MICRO_USD;

  const v1 = new Map<number, IssueTheme[]>();
  const v2 = new Map<number, IssueTheme[]>();
  const reference = new Map<number, IssueTheme[]>();
  const indexed = sample.map((review, n) => ({ n, review, input: redactedInput(review, guestOf(review), company) }));

  const pass = async (
    model: string,
    prompt: string,
    into: Map<number, IssueTheme[]>,
    margin: number,
    inFlight: number,
  ) => {
    await eachOf(indexed, async ({ n, input }) => {
      const themes = await readThemes(client, model, prompt, input, ledger);
      if (themes !== null) {
        into.set(n, themes);
      }
    }, roomFor(margin, inFlight), inFlight);
  };

  await pass(MODEL_ID, promptV1, v1, WORKING_MARGIN_MICRO_USD, CONCURRENCY);
  await pass(MODEL_ID, THEMES_SYSTEM_PROMPT, v2, WORKING_MARGIN_MICRO_USD, CONCURRENCY);
  await pass(REFERENCE_MODEL, THEMES_SYSTEM_PROMPT, reference, REFERENCE_MARGIN_MICRO_USD, REFERENCE_CONCURRENCY);

  const rows = indexed.flatMap(({ n, review }) => {
    const [one, two, three] = [v1.get(n), v2.get(n), reference.get(n)];
    return one === undefined || two === undefined || three === undefined
      ? []
      : [{ n, band: bandOf(review.row.rating), v1: one, v2: two, reference: three }];
  });
  const next: Saved = {
    ...saved,
    spent: saved.spent + ledger.spent,
    fresh: { read: rows.length, failed: ledger.failed, spent: ledger.spent, population, rows },
  };
  await Deno.writeTextFile(V2_FILE, JSON.stringify(next));
  console.log(JSON.stringify({
    drawn: sample.length,
    compared: rows.length,
    failed: ledger.failed,
    spent_usd: ledger.spent / 1e6,
    total_usd: next.spent / 1e6,
  }));
}

async function report(): Promise<void> {
  const saved = await loadSaved();
  const { population, rows: first } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as {
    population: Record<Band, number>;
    rows: ProbeRow[];
  };
  const { rows: before } = JSON.parse(await Deno.readTextFile(AGREEMENT_FILE)) as { rows: AgreementRow[] };
  const fresh = saved.fresh;
  const rowOf = (row: { n: number; band: Band; reference: IssueTheme[] }, working: IssueTheme[]): AgreementRow => ({
    n: row.n,
    band: row.band,
    language: "und",
    working,
    reference: row.reference,
  });
  console.log(JSON.stringify({
    total_usd: saved.spent / 1e6,
    first_sample: first.length,
    old_v1: agreementOf(before, population),
    old_v2: saved.old === undefined ? null : agreementOf(saved.old.rows, population),
    old_failed: saved.old?.failed ?? null,
    new_read: fresh?.read ?? null,
    new_failed: fresh?.failed ?? null,
    new_v1: fresh === undefined ? null : agreementOf(fresh.rows.map((row) => rowOf(row, row.v1)), fresh.population),
    new_v2: fresh === undefined ? null : agreementOf(fresh.rows.map((row) => rowOf(row, row.v2)), fresh.population),
  }, null, 1));
}

if (import.meta.main) {
  const commands: Readonly<Record<string, () => Promise<void>>> = { old: readOld, new: readNew, report };
  const command = commands[Deno.args[0] ?? ""];
  if (command === undefined) {
    console.error("usage: theme-probe-v2.ts old|new|report");
    Deno.exit(2);
  }
  await command();
}
