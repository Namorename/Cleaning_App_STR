// Builds the read-only probe that finds the cleaning before each reviewed stay.
// Input: reviews.ndjson (text-free features). Output: link.sql (ids, dates and scores only).
// node build-link-sql.mjs <reviews.ndjson> <template.sql> <out.sql> [arrivalFrom]
import { readFileSync, writeFileSync } from 'node:fs';

const [input, template, out, from = '2026-10-15'] = process.argv.slice(2);
const rows = readFileSync(input, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  .filter((r) => r.status === 'published' && !r.hidden && r.arrival >= from && Number.isInteger(r.reservation));
const num = (v) => (typeof v === 'number' ? String(v) : 'null');
const values = rows.map((r) =>
  `(${r.id}, ${r.reservation}, ${r.listing}, '${r.channel}', ${num(r.cats.cleanliness)}, ${num(r.rating)}, date '${r.arrival}')`,
).join(',\n');
writeFileSync(out, readFileSync(template, 'utf8').replace('/*VALUES*/', () => values));
process.stdout.write(`${rows.length} reviews\n`);
