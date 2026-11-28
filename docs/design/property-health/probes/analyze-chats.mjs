// Joins chat cards with text-free message features and prints only aggregates.
// node analyze-chats.mjs <cards.json> <messages.ndjson> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [cardsFile, messagesFile, outFile] = process.argv.slice(2);
const cards = JSON.parse(readFileSync(cardsFile, 'utf8'));
const messages = readFileSync(messagesFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const t = (s) => new Date(`${s.replace(' ', 'T')}Z`).getTime();
const MIN = 60_000;

// Templates: one body shape sent by the host side in three or more conversations.
const convsByShape = new Map();
for (const m of messages) {
  if (m.inc || m.shape === null) continue;
  const set = convsByShape.get(m.shape) ?? new Set();
  set.add(m.conv);
  convsByShape.set(m.shape, set);
}
const kindOf = (m) => {
  if (m.inc) return 'guest';
  if (m.comm || m.event) return 'auto_scheduled';
  if ((convsByShape.get(m.shape)?.size ?? 0) >= 3) return m.user ? 'template_by_user' : 'template_no_user';
  return m.user ? 'person_user' : 'person_no_user';
};
const byConv = new Map();
for (const m of messages) {
  const list = byConv.get(m.conv) ?? [];
  list.push({ ...m, ms: t(m.at), kind: kindOf(m) });
  byConv.set(m.conv, list);
}
for (const list of byConv.values()) list.sort((a, b) => a.ms - b.ms);

const tally = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});
const bucket = (min) => (min === null ? 'none' : min <= 10 ? '<=10' : min <= 30 ? '<=30' : min <= 60 ? '<=60' : min <= 90 ? '<=90' : min <= 180 ? '<=180' : '>180');
// STRICT=1: only a message with a Hostaway user counts as a person (no-user replies are mostly fast bot answers).
const isPerson = process.env.STRICT === '1'
  ? (k) => k === 'person_user' || k === 'template_by_user'
  : (k) => k === 'person_user' || k === 'person_no_user' || k === 'template_by_user';

/** The first reply of any kind and the first reply by a person after the guest message at startIndex. */
function replyAfter(list, startIndex) {
  const start = list[startIndex];
  let firstAny = null;
  let firstPerson = null;
  for (let i = startIndex + 1; i < list.length; i += 1) {
    const m = list[i];
    if (m.inc) continue;
    if (firstAny === null) firstAny = m;
    if (isPerson(m.kind)) { firstPerson = m; break; }
  }
  return {
    any: firstAny ? (firstAny.ms - start.ms) / MIN : null,
    anyKind: firstAny?.kind ?? null,
    person: firstPerson ? (firstPerson.ms - start.ms) / MIN : null,
    personKind: firstPerson?.kind ?? null,
  };
}

const sampled = new Set(byConv.keys());
const rows = [];
for (const card of cards) {
  if (!card.exact || !sampled.has(card.conv)) continue;
  const list = byConv.get(card.conv);
  const created = new Date(card.created).getTime();
  let trigger = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].inc && list[i].ms <= created && list[i].ms >= created - 60 * MIN) trigger = i;
  }
  if (trigger < 0) { rows.push({ ...card, found: false }); continue; }
  let start = trigger;
  for (let i = trigger - 1; i >= 0; i -= 1) {
    if (!list[i].inc) { if (isPerson(list[i].kind)) break; continue; }
    if (list[start].ms - list[i].ms > 30 * MIN) break;
    start = i;
  }
  const reply = replyAfter(list, start);
  rows.push({
    ...card,
    found: true,
    cardLag: (created - list[trigger].ms) / MIN,
    person: reply.person,
    personKind: reply.personKind,
    any: reply.any,
    anyKind: reply.anyKind,
    answeredBeforeCard: reply.person !== null && list[start].ms + reply.person * MIN <= created,
  });
}

const found = rows.filter((r) => r.found);
const lags = found.map((r) => r.cardLag).sort((a, b) => a - b);
const q = (arr, p) => (arr.length ? Math.round(arr[Math.floor(p * (arr.length - 1))] * 10) / 10 : null);
const personTimes = found.filter((r) => r.person !== null).map((r) => r.person).sort((a, b) => a - b);
const INFO = new Set(['access']);
const group = (r) => (INFO.has(r.kind) || ['internet_tv', 'other'].includes(r.subject) ? 'info_like' : 'physical');

// Baseline: every guest burst in the sampled conversations, card or not.
const base = [];
for (const list of byConv.values()) {
  for (let i = 0; i < list.length; i += 1) {
    if (!list[i].inc) continue;
    const previous = list[i - 1];
    if (previous && previous.inc && list[i].ms - previous.ms <= 30 * MIN) continue;
    base.push(replyAfter(list, i));
  }
}

const result = {
  conversations: byConv.size,
  messages: messages.length,
  byKind: tally(messages.map((m) => ({ k: kindOf(m) })), 'k'),
  hostMessages: messages.filter((m) => !m.inc).length,
  hostWithUser: messages.filter((m) => !m.inc && m.user).length,
  hostAuto: messages.filter((m) => !m.inc && (m.comm || m.event)).length,
  distinctUsers: new Set(messages.filter((m) => m.user).map((m) => m.user)).size,
  sentUsingHostaway: tally(messages.filter((m) => !m.inc).map((m) => ({ k: String(m.sentHA) })), 'k'),
  templateShapes: [...convsByShape.values()].filter((s) => s.size >= 3).length,
  cardsInSample: rows.length,
  cardsTriggerFound: found.length,
  cardLagMin: { p10: q(lags, 0.1), p50: q(lags, 0.5), p90: q(lags, 0.9) },
  personReplyBuckets: tally(found.map((r) => ({ k: bucket(r.person) })), 'k'),
  personReplyKind: tally(found.map((r) => ({ k: String(r.personKind) })), 'k'),
  firstReplyKind: tally(found.map((r) => ({ k: String(r.anyKind) })), 'k'),
  personReplyMin: { p25: q(personTimes, 0.25), p50: q(personTimes, 0.5), p75: q(personTimes, 0.75), p90: q(personTimes, 0.9) },
  answeredBeforeCard: found.filter((r) => r.answeredBeforeCard).length,
  byGroup: Object.fromEntries(['info_like', 'physical'].map((g) => {
    const part = found.filter((r) => group(r) === g);
    return [g, { n: part.length, buckets: tally(part.map((r) => ({ k: bucket(r.person) })), 'k'), beforeCard: part.filter((r) => r.answeredBeforeCard).length }];
  })),
  byUrgency: Object.fromEntries(['high', 'normal', 'low'].map((u) => {
    const part = found.filter((r) => r.urgency === u);
    return [u, { n: part.length, buckets: tally(part.map((r) => ({ k: bucket(r.person) })), 'k') }];
  })),
  byStatus: Object.fromEntries([...new Set(found.map((r) => r.status))].map((s) => {
    const part = found.filter((r) => r.status === s);
    return [s, { n: part.length, buckets: tally(part.map((r) => ({ k: bucket(r.person) })), 'k') }];
  })),
  baselineBursts: base.length,
  baselinePersonBuckets: tally(base.map((b) => ({ k: bucket(b.person) })), 'k'),
  baselineAnyKind: tally(base.map((b) => ({ k: String(b.anyKind) })), 'k'),
};
writeFileSync(outFile, JSON.stringify({ result, rows: found.map((r) => ({ id: r.id, person: r.person, lag: r.cardLag, kind: r.kind, subject: r.subject, urgency: r.urgency, status: r.status, before: r.answeredBeforeCard })) }, null, 1));
process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
