// Reads one Hostaway /reviews page (the full payload) on stdin and keeps only derived,
// text-free features. Never prints or writes a text, a name or a value of a text field.
// node derive-reviews.mjs <out.ndjson> <keys.json>
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [out, keysFile] = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const items = Array.isArray(payload?.result) ? payload.result : [];

const CHANNEL = { 2018: 'airbnb', 2005: 'booking', 2002: 'vrbo', 2000: 'direct', 2013: 'booking_engine', 2010: 'vrbo_ical' };
const keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : {};
const len = (value) => (typeof value === 'string' ? value.trim().length : 0);

let published = 0;
let last = null;
for (const item of items) {
  const channel = CHANNEL[item.channelId] ?? `ch${item.channelId}`;
  const tally = (keys[channel] ??= { items: 0, fields: {}, categories: {}, categoryComments: {} });
  tally.items += 1;
  for (const [key, value] of Object.entries(item)) {
    const filled = value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
    tally.fields[key] = (tally.fields[key] ?? 0) + (filled ? 1 : 0);
  }
  const cats = {};
  for (const entry of Array.isArray(item.reviewCategory) ? item.reviewCategory : []) {
    if (entry && typeof entry.category === 'string') {
      tally.categories[entry.category] = (tally.categories[entry.category] ?? 0) + 1;
      if (len(entry.comment) > 0) tally.categoryComments[entry.category] = (tally.categoryComments[entry.category] ?? 0) + 1;
      if (typeof entry.rating === 'number') cats[entry.category] = entry.rating;
    }
  }
  if (item.status === 'published') published += 1;
  if (item.submittedAt && (last === null || item.submittedAt > last)) last = item.submittedAt;
  const row = {
    id: item.id,
    listing: item.listingMapId,
    reservation: item.reservationId ?? null,
    channel,
    type: item.type,
    status: item.status,
    hidden: item.isHidden === 1 || item.isHidden === true,
    rating: typeof item.rating === 'number' ? item.rating : null,
    cats,
    arrival: item.arrivalDate ?? null,
    departure: item.departureDate ?? null,
    submitted: item.submittedAt ?? null,
    pub: len(item.publicReview),
    priv: len(item.privateFeedback),
    reply: len(item.revieweeResponse),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
}
writeFileSync(keysFile, JSON.stringify(keys, null, 1));
process.stdout.write(`items ${items.length} published ${published} last ${last} count ${payload?.count ?? '?'} limit ${payload?.limit ?? '?'} offset ${payload?.offset ?? '?'}\n`);
