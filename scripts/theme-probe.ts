// The accuracy probe of the theme reader (docs/property-intelligence-plan.md §7.3,
// Э2): three hundred public reviews through the same redaction, prompt and client
// as read-signal-history. Run from the root of the repository:
//
//   npx deno run --node-modules-dir=none --no-lock --allow-run=node --allow-read \
//     --allow-write --allow-env --allow-net=api.anthropic.com scripts/theme-probe.ts read
//   npx deno run ... scripts/theme-probe.ts report
//   npx deno run ... scripts/theme-probe.ts sample   (everything before the model, no key)
//
// `read` needs the model's key in ~/.str-ops/anthropic-probe-key.txt, which is read
// and never printed. It stops at one dollar by the model's own usage figures.
//
// Texts and names live in this process only. Hostaway is reached through
// scripts/hostaway-get.mjs (GET, its own stored token) and the company's names
// through scripts/cloud-read.mjs (read-only). What lands on disk, in
// ~/.str-ops/theme-probe/, is ids, months, ratings and labels: never a text, never
// a name. The console gets counts.

import { join } from "node:path";

import { normalizeHostawayReview } from "../supabase/functions/_shared/signals/hostaway.ts";
import { addDays, monthStart } from "../supabase/functions/_shared/signals/history-plan.ts";
import { hasUsableName, redactText } from "../supabase/functions/_shared/signals/redact.ts";
import type { NeutralReview } from "../supabase/functions/_shared/signals/adapter.ts";
import {
  accuracyOf,
  type Band,
  bandOf,
  drawSample,
  pickForCheck,
  PROBE_CEILING_MICRO_USD,
  PROBE_CHECKS,
  PROBE_PER_BAND,
  PROBE_REREADS,
  PROBE_SEED,
  type ProbeRow,
  type ProbeVerdict,
  shuffled,
  summarize,
} from "../supabase/functions/_shared/signals/theme-probe.ts";
import {
  AnthropicThemeClient,
  costMicroUsd,
  parseThemes,
  type ThemeInput,
  THEMES_DETECTOR,
  THEMES_MAX_TEXT_CHARS,
  WORST_CALL_MICRO_USD,
} from "../supabase/functions/_shared/signals/themes-read.ts";
import type { IssueTheme } from "../supabase/functions/_shared/signals/themes.ts";

const HOME = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
const KEY_FILE = join(HOME, ".str-ops", "anthropic-probe-key.txt");
export const PROBE_DIR = join(HOME, ".str-ops", "theme-probe");
export const SAMPLE_FILE = join(PROBE_DIR, "sample.json");
export const VERDICTS_FILE = join(PROBE_DIR, "verdicts.json");

const PAUSE_MS = 900;
const CONCURRENCY = 4;
const DEPTH_MONTHS = 12;

type Raw = Record<string, unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One GET through the pinned script; its output stays in this process. */
export async function hostawayGet(path: string): Promise<Raw> {
  const { code, stdout } = await new Deno.Command("node", {
    args: ["scripts/hostaway-get.mjs", path],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (code !== 0) {
    throw new Error(`hostaway-get failed for ${path.split("?")[0]}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as Raw;
}

async function listAll(path: string): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let offset = 0;; offset += 500) {
    const page = await hostawayGet(`${path}&limit=500&offset=${offset}`);
    const result = (page.result ?? []) as Raw[];
    rows.push(...result);
    if (result.length < 500) {
      return rows;
    }
    await sleep(PAUSE_MS);
  }
}

/** The company's people and places, for the redaction: read, used, never printed. */
export async function companyNames(): Promise<{ staff: string[]; places: string[] }> {
  const file = await Deno.makeTempFile({ suffix: ".sql" });
  await Deno.writeTextFile(
    file,
    `select jsonb_build_object(
       'staff', (select coalesce(jsonb_agg(full_name), '[]'::jsonb) from public.profiles where full_name is not null),
       'places', (select coalesce(jsonb_agg(name), '[]'::jsonb) from public.properties)) as out;`,
  );
  try {
    const { code, stdout } = await new Deno.Command("node", {
      args: ["scripts/cloud-read.mjs", file],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (code !== 0) {
      throw new Error("cloud-read failed");
    }
    const rows = JSON.parse(new TextDecoder().decode(stdout)) as { out: { staff: string[]; places: string[] } }[];
    return rows[0].out;
  } finally {
    await Deno.remove(file);
  }
}

/** Live public reviews of the last twelve months, read in memory. */
export async function publicReviews(today: string): Promise<NeutralReview[]> {
  const from = monthStart(today, DEPTH_MONTHS - 1);
  const rows = await listAll(
    `reviews?type=guest-to-host&sortBy=departureDate&sortOrder=asc&departureDateStart=${from}&departureDateEnd=${today}`,
  );
  return rows
    .filter((row) => row.status === "published")
    .flatMap((row) => {
      try {
        return [normalizeHostawayReview(row)];
      } catch {
        return [];
      }
    })
    .filter((review) => !review.row.is_hidden && review.texts.publicText !== null);
}

/** Booking id → the guest's names, month by month. In memory only. */
export async function bookingNames(today: string): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  for (let back = 0; back < DEPTH_MONTHS; back += 1) {
    const start = monthStart(today, back);
    const end = addDays(monthStart(addDays(start, 31)), -1);
    const rows = await listAll(`reservations?departureStartDate=${start}&departureEndDate=${end}`);
    for (const row of rows) {
      const found = [row.guestName, row.guestFirstName, row.guestLastName]
        .filter((name): name is string => typeof name === "string" && name.trim() !== "");
      names.set(String(row.id), found);
    }
    await sleep(PAUSE_MS);
  }
  return names;
}

export function redactedInput(
  review: NeutralReview,
  guest: readonly string[],
  company: { readonly staff: readonly string[]; readonly places: readonly string[] },
): ThemeInput {
  const text = (review.texts.publicText ?? "").slice(0, THEMES_MAX_TEXT_CHARS);
  return {
    rating: review.row.rating,
    publicText: redactText(text, {
      guest,
      staff: company.staff,
      places: [...review.listingNames, ...company.places],
    }),
    privateText: null,
  };
}

/** `dry` stops before the model: the whole way of the sample, at no cost and with no key. */
async function read(dry: boolean): Promise<void> {
  const key = (await Deno.readTextFile(KEY_FILE).catch(() => "")).trim();
  if (key === "" && !dry) {
    console.error(`No key in ${KEY_FILE}: the model cannot be called.`);
    Deno.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const [reviews, names, company] = [
    await publicReviews(today),
    await bookingNames(today),
    await companyNames(),
  ];

  const guestOf = (review: NeutralReview): string[] => [
    ...review.guestNames,
    ...(names.get(review.row.external_reservation_id ?? "") ?? []),
  ];
  const usable = reviews.filter((review) => hasUsableName(guestOf(review)));
  const population: Record<Band, number> = { low: 0, mid: 0, high: 0 };
  for (const review of usable) {
    population[bandOf(review.row.rating)] += 1;
  }
  const sample = drawSample(usable, (review) => review.row.rating, PROBE_PER_BAND, PROBE_SEED);
  if (dry) {
    console.log(JSON.stringify({
      reviews_in_window: reviews.length,
      with_a_usable_name: usable.length,
      population,
      sample: sample.length,
      company_names: company.staff.length + company.places.length,
      bookings_with_names: names.size,
    }));
    return;
  }

  const client = new AnthropicThemeClient(key);
  let spent = 0;
  let failed = 0;
  let invalid = 0;
  let stoppedAtCeiling = false;

  const readOne = async (review: NeutralReview): Promise<IssueTheme[] | null> => {
    if (spent + WORST_CALL_MICRO_USD > PROBE_CEILING_MICRO_USD) {
      stoppedAtCeiling = true;
      return null;
    }
    spent += WORST_CALL_MICRO_USD;
    try {
      const reading = await client.read(redactedInput(review, guestOf(review), company));
      spent += costMicroUsd(reading) - WORST_CALL_MICRO_USD;
      const answer = parseThemes(reading.raw);
      invalid += answer.invalid;
      return answer.labels.filter((label) => label.confidence >= 0.6).map((label) => label.theme);
    } catch {
      failed += 1;
      return null;
    }
  };

  const themes = new Map<NeutralReview, IssueTheme[]>();
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < sample.length) {
      const review = sample[next];
      next += 1;
      const found = await readOne(review);
      if (found !== null) {
        themes.set(review, found);
      }
    }
  }));

  const again = new Map<NeutralReview, IssueTheme[]>();
  for (const review of shuffled([...themes.keys()], PROBE_SEED + 9).slice(0, PROBE_REREADS)) {
    const found = await readOne(review);
    if (found !== null) {
      again.set(review, found);
    }
  }

  const rows: ProbeRow[] = [...themes.entries()].map(([review, found], index) => ({
    n: index + 1,
    reviewId: review.row.external_id,
    band: bandOf(review.row.rating),
    month: (review.row.departure_date ?? "").slice(0, 7),
    channel: review.row.channel,
    rating: review.row.rating,
    themes: found,
    ...(again.has(review) ? { themesAgain: again.get(review) } : {}),
  }));
  const checks = pickForCheck(rows, PROBE_CHECKS, PROBE_SEED + 20).map((row) => row.n);

  await Deno.mkdir(PROBE_DIR, { recursive: true });
  await Deno.writeTextFile(
    SAMPLE_FILE,
    JSON.stringify({ detector: THEMES_DETECTOR, population, rows, checks, spent }, null, 1),
  );
  console.log(JSON.stringify({
    detector: THEMES_DETECTOR,
    reviews_in_window: reviews.length,
    population,
    calls: rows.length + again.size + failed,
    failed,
    invalid_items: invalid,
    spent_usd: spent / 1_000_000,
    stopped_at_ceiling: stoppedAtCeiling,
    summary: summarize(rows, population),
    to_check: checks.length,
  }, null, 1));
}

async function report(): Promise<void> {
  const { rows, population, checks } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as {
    rows: ProbeRow[];
    population: Record<Band, number>;
    checks: number[];
  };
  const verdicts = JSON.parse(await Deno.readTextFile(VERDICTS_FILE).catch(() => "[]")) as ProbeVerdict[];
  const summary = summarize(rows, population);
  console.log(JSON.stringify({
    summary,
    checks_done: verdicts.length,
    checks_wanted: checks.length,
    accuracy: accuracyOf(verdicts, summary.otherShare),
  }, null, 1));
}

if (import.meta.main) {
  const command = Deno.args[0];
  if (command === "read" || command === "sample") {
    await read(command === "sample");
  } else if (command === "report") {
    await report();
  } else {
    console.error("usage: theme-probe.ts sample|read|report");
    Deno.exit(2);
  }
}
