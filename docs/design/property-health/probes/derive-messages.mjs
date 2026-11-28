// Reads one Hostaway /conversations/{id}/messages page (full payload) on stdin and keeps only
// derived, text-free features: direction, times, automation markers, a hash and a length of the
// body (to spot templates). Never prints or writes a text, a name, an e-mail or a phone.
// node derive-messages.mjs <conversationId> <out.ndjson> <keys.json>
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [conv, out, keysFile] = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const items = Array.isArray(payload?.result) ? payload.result : [];
const keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : { items: 0, fields: {}, commType: {}, status: {} };

const short = (value) => createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
// Templates differ only in names, dates and numbers: digits dropped, spaces collapsed.
const shape = (body) => body.toLowerCase().replace(/[0-9]+/g, '#').replace(/\s+/g, ' ').trim();

for (const item of items) {
  keys.items += 1;
  for (const [key, value] of Object.entries(item)) {
    const filled = value !== null && value !== '' && value !== 0 && !(Array.isArray(value) && value.length === 0);
    keys.fields[key] = (keys.fields[key] ?? 0) + (filled ? 1 : 0);
  }
  const ctype = typeof item.communicationType === 'string' ? item.communicationType : String(item.communicationType);
  keys.commType[ctype] = (keys.commType[ctype] ?? 0) + 1;
  keys.status[String(item.status)] = (keys.status[String(item.status)] ?? 0) + 1;
  const body = typeof item.body === 'string' ? item.body : '';
  const row = {
    conv,
    id: item.id,
    inc: item.isIncoming === 1 || item.isIncoming === true || item.isIncoming === '1',
    at: item.insertedOn ?? null,
    date: item.date ?? null,
    comm: Number.isInteger(item.communicationId) && item.communicationId > 0,
    event: typeof item.communicationEvent === 'string' && item.communicationEvent !== '',
    ctype,
    user: item.userId ? short(item.userId) : null,
    sentHA: item.sentUsingHostaway ?? null,
    status: item.status ?? null,
    len: body.trim().length,
    shape: body.trim() === '' ? null : short(shape(body)),
    files: (Array.isArray(item.attachments) ? item.attachments.length : 0) + (Array.isArray(item.imagesUrls) ? item.imagesUrls.length : 0),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
}
writeFileSync(keysFile, JSON.stringify(keys, null, 1));
process.stdout.write(`${items.length}\n`);
