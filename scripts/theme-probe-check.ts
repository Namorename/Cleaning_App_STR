// The person's half of the accuracy probe (docs/property-intelligence-plan.md §7.3):
// a page on this machine, http://127.0.0.1:8097, that shows one review at a time
// beside the model's themes. Run from the root of the repository, after
// `theme-probe.ts read`:
//
//   npx deno run --node-modules-dir=none --no-lock --allow-run=node --allow-read \
//     --allow-write --allow-env --allow-net=127.0.0.1:8097 scripts/theme-probe-check.ts
//
// The text is read from Hostaway when its page opens, redacted, shown and
// forgotten: only the verdicts reach the disk (~/.str-ops/theme-probe/verdicts.json:
// a number and theme codes). The page answers on the loopback only.

import { hasUsableName } from "../supabase/functions/_shared/signals/redact.ts";
import { normalizeHostawayReview } from "../supabase/functions/_shared/signals/hostaway.ts";
import type { ProbeRow, ProbeVerdict } from "../supabase/functions/_shared/signals/theme-probe.ts";
import { ISSUE_THEMES, type IssueTheme } from "../supabase/functions/_shared/signals/themes.ts";
import { companyNames, hostawayGet, redactedInput, SAMPLE_FILE, VERDICTS_FILE } from "./theme-probe.ts";

const PORT = 8097;

const { rows, checks } = JSON.parse(await Deno.readTextFile(SAMPLE_FILE)) as {
  rows: ProbeRow[];
  checks: number[];
};
const company = await companyNames();
let verdicts = JSON.parse(await Deno.readTextFile(VERDICTS_FILE).catch(() => "[]")) as ProbeVerdict[];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function redactedText(reviewId: string): Promise<string> {
  const body = await hostawayGet(`reviews/${reviewId}`);
  const review = normalizeHostawayReview(body.result);
  if (!hasUsableName(review.guestNames)) {
    return "(no usable name known: the text is not shown)";
  }
  return redactedInput(review, review.guestNames, company).publicText ?? "";
}

async function page(row: ProbeRow, position: number): Promise<string> {
  const text = await redactedText(row.reviewId);
  const boxes = row.themes.map((theme) =>
    `<label class="row"><input type="checkbox" name="right" value="${theme}" checked> ${theme}</label>`
  ).join("") || "<p>Модель не нашла жалоб.</p>";
  const others = ISSUE_THEMES.filter((theme) => !row.themes.includes(theme))
    .map((theme) => `<label class="chip"><input type="checkbox" name="missed" value="${theme}"> ${theme}</label>`)
    .join("");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проба ${position}</title>
<style>body{font:16px/1.5 system-ui;max-width:760px;margin:24px auto;padding:0 16px}
blockquote{background:#f6f3ee;padding:12px 16px;margin:12px 0;white-space:pre-wrap}
.row{display:block;padding:4px 0}.chip{display:inline-block;padding:2px 8px;font-size:14px}
button{font:inherit;padding:8px 20px;margin-top:12px}small{color:#666}</style>
<p><small>${position} из ${checks.length} · оценка ${row.rating ?? "нет"} · ${escapeHtml(row.channel)}</small></p>
<blockquote>${escapeHtml(text)}</blockquote>
<form method="post" action="/verdict?n=${row.n}">
<h3>Темы модели: снимите галочку с неверных</h3>${boxes}
<details><summary>Модель что-то пропустила?</summary>${others}</details>
<button>Дальше</button></form></html>`;
}

function verdictOf(row: ProbeRow, form: FormData): ProbeVerdict {
  const right = form.getAll("right").map(String) as IssueTheme[];
  return {
    n: row.n,
    right,
    wrong: row.themes.filter((theme) => !right.includes(theme)),
    missed: form.getAll("missed").map(String) as IssueTheme[],
  };
}

function nextRow(): { row: ProbeRow; position: number } | null {
  const done = new Set(verdicts.map((verdict) => verdict.n));
  const left = checks.filter((n) => !done.has(n));
  const row = rows.find((item) => item.n === left[0]);
  return row === undefined ? null : { row, position: checks.length - left.length + 1 };
}

Deno.serve({ hostname: "127.0.0.1", port: PORT }, async (request) => {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/verdict") {
    const row = rows.find((item) => item.n === Number(url.searchParams.get("n")));
    if (row !== undefined) {
      verdicts = [...verdicts.filter((verdict) => verdict.n !== row.n), verdictOf(row, await request.formData())];
      await Deno.writeTextFile(VERDICTS_FILE, JSON.stringify(verdicts));
    }
    return new Response(null, { status: 303, headers: { Location: "/" } });
  }
  const next = nextRow();
  const html = next === null
    ? '<!doctype html><meta charset="utf-8"><p>Готово. Страницу можно закрыть.</p>'
    : await page(next.row, next.position);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
