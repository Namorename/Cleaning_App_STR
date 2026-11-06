// The agreement check of the theme reader, in place of a person's marks: the same
// reviews, the same redaction, the same prompt and list of themes, read by a stronger
// model and compared with the working model's labels in sample.json. Run from the root:
//
//   npx deno run --node-modules-dir=none --no-lock --allow-run=node --allow-read \
//     --allow-write --allow-env --allow-net=api.anthropic.com scripts/theme-probe-agree.ts \
//     read claude-opus-5-5
//   npx deno run ... scripts/theme-probe-agree.ts report
//
// `read` stops at one dollar by the model's usage figures. The key is read from
// ~/.str-ops/anthropic-probe-key.txt and never printed. Texts live in this process
// only; agreement.json holds numbers, languages and theme codes.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { join } from "node:path";

import { hasUsableName } from "../supabase/functions/_shared/signals/redact.ts";
import {
  agreementOf,
  type AgreementRow,
  PROBE_SEED,
  type ProbeRow,
  shuffled,
} from "../supabase/functions/_shared/signals/theme-probe.ts";
import {
  parseThemes,
  renderThemeInput,
  THEMES_MAX_TOKENS,
  THEMES_SCHEMA,
  THEMES_SYSTEM_PROMPT,
} from "../supabase/functions/_shared/signals/themes-read.ts";
import { bookingNames, companyNames, PROBE_DIR, publicReviews, redactedInput, SAMPLE_FILE } from "./theme-probe.ts";

const HOME = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
const KEY_FILE = join(HOME, ".str-ops", "anthropic-probe-key.txt");
const AGREEMENT_FILE = join(PROBE_DIR, "agreement.json");

const CEILING_MICRO_USD = 1_000_000;
const MIN_CONFIDENCE = 0.6;
const CONCURRENCY = 4;
/** Read on 2026-11-06, in millionths of a dollar per token. */
const PRICES: Readonly<Record<string, { input: number; write: number; read: number; output: number }>> = {
  "claude-opus-5-5": { input: 4, write: 5, read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, write: 2.5, read: 0.1, output: 10 },
};
/** What one more call may cost at most, so the ceiling is not passed by a call in flight. */
const CALL_MARGIN_MICRO_USD = 12_000;

const SCHEMA = {
  ...THEMES_SCHEMA,
  required: ["language", "complaints"],
  properties: {
    language: { type: "string", description: "Two-letter ISO 639-1 code of the language the guest wrote in." },
    ...THEMES_SCHEMA.properties,
  },
};

async function read(model: string): Promise<void> {
  const price = PRICES[model];
  const key = (await Deno.readTextFile(KEY_FILE).catch(() => "")).trim();
  if (price === undefined || key === "") {
    console.error("A known model and the key file are needed.");
    Deno.exit(2);
  }
  const { rows } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as { rows: ProbeRow[] };
  const today = new Date().toISOString().slice(0, 10);
  const reviews = await publicReviews(today);
  const names = await bookingNames(today);
  const company = await companyNames();
  const byId = new Map(reviews.map((review) => [review.row.external_id, review]));
  const client = new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", authToken: null, timeout: 60_000, maxRetries: 0 });

  const queue = shuffled(rows, PROBE_SEED + 40);
  const done: AgreementRow[] = [];
  let spent = 0;
  let failed = 0;
  let missing = 0;
  let stopped = false;
  let next = 0;
  let cacheRead = 0;

  const readOne = async (row: ProbeRow): Promise<void> => {
    const review = byId.get(row.reviewId);
    const guest = review === undefined ? [] : [
      ...review.guestNames,
      ...(names.get(review.row.external_reservation_id ?? "") ?? []),
    ];
    if (review === undefined || !hasUsableName(guest)) {
      missing += 1;
      return;
    }
    try {
      const response = await client.messages.create({
        model,
        max_tokens: THEMES_MAX_TOKENS,
        system: [{ type: "text", text: THEMES_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: renderThemeInput(redactedInput(review, guest, company)) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      } as Anthropic.MessageCreateParamsNonStreaming);
      const usage = response.usage;
      cacheRead += usage.cache_read_input_tokens ?? 0;
      spent += Math.ceil(
        usage.input_tokens * price.input + (usage.cache_creation_input_tokens ?? 0) * price.write +
          (usage.cache_read_input_tokens ?? 0) * price.read + usage.output_tokens * price.output,
      );
      const block = response.content.find((part) => part.type === "text");
      const raw = JSON.parse(block !== undefined && block.type === "text" ? block.text : "{}") as { language?: unknown };
      const labels = parseThemes(raw).labels.filter((label) => label.confidence >= MIN_CONFIDENCE);
      done.push({
        n: row.n,
        band: row.band,
        language: typeof raw.language === "string" ? raw.language.toLowerCase().slice(0, 2) : "und",
        working: row.themes,
        reference: labels.map((label) => label.theme),
      });
    } catch (error: unknown) {
      failed += 1;
      spent += CALL_MARGIN_MICRO_USD;
      if (error instanceof Anthropic.NotFoundError || error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError) {
        console.error(`The model refused the key or is not there: ${error.status}`);
        stopped = true;
      }
    }
  };

  // The first call alone writes the cache the others read.
  await readOne(queue[next++]);
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (!stopped && next < queue.length) {
      if (spent + CONCURRENCY * CALL_MARGIN_MICRO_USD > CEILING_MICRO_USD) {
        stopped = true;
        return;
      }
      await readOne(queue[next++]);
    }
  }));

  await Deno.writeTextFile(AGREEMENT_FILE, JSON.stringify({ model, rows: done, spent, failed, missing }));
  console.log(JSON.stringify({ model, read: done.length, failed, missing, spent_usd: spent / 1_000_000, stopped, cache_read_tokens: cacheRead }));
}

async function report(): Promise<void> {
  const { model, rows, spent, failed, missing } = JSON.parse(await Deno.readTextFile(AGREEMENT_FILE)) as {
    model: string;
    rows: AgreementRow[];
    spent: number;
    failed: number;
    missing: number;
  };
  const { population } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE));
  console.log(JSON.stringify({ model, spent_usd: spent / 1_000_000, failed, missing, ...agreementOf(rows, population) }, null, 1));
}

if (import.meta.main) {
  if (Deno.args[0] === "read") {
    await read(Deno.args[1] ?? "claude-opus-5-5");
  } else if (Deno.args[0] === "report") {
    await report();
  } else {
    console.error("usage: theme-probe-agree.ts read <model>|report");
    Deno.exit(2);
  }
}
