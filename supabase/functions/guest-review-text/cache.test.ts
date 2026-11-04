import { assertEquals } from "jsr:@std/assert@1";

import {
  MAX_PAGE_ITEMS,
  MAX_PAGES,
  PAGE_TTL_MS,
  pageKey,
  ReviewPageCache,
  type Schedule,
} from "./cache.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const OCTOBER = { start: "2026-09-30", end: "2026-11-01" };
const NOVEMBER = { start: "2026-10-31", end: "2026-12-01" };

/** A schedule the test runs by hand: the drops waiting, and whether each was called off. */
function manualSchedule(): { schedule: Schedule; drops: { run: () => void; cancelled: boolean }[] } {
  const drops: { run: () => void; cancelled: boolean }[] = [];
  const schedule: Schedule = (drop) => {
    const entry = { run: drop, cancelled: false };
    drops.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { schedule, drops };
}

Deno.test("a page is the company's and its window's: another company or month is another key", () => {
  assertEquals(pageKey(HOST, OCTOBER), `${HOST}|2026-09-30|2026-11-01`);
  assertEquals(pageKey(HOST, OCTOBER) === pageKey("22222222-2222-4222-8222-222222222222", OCTOBER), false);
  assertEquals(pageKey(HOST, OCTOBER) === pageKey(HOST, NOVEMBER), false);
});

Deno.test("a page is served for ten minutes and not a moment longer", () => {
  const cache = new ReviewPageCache({ schedule: () => () => {} });
  cache.set("k", ["a"], 0);

  assertEquals(cache.get("k", PAGE_TTL_MS - 1), ["a"]);
  assertEquals(cache.get("k", PAGE_TTL_MS), undefined);
  assertEquals(cache.size, 0);
});

Deno.test("the timer drops a page at its time, and a newer page of the key outlives the old timer", () => {
  const { schedule, drops } = manualSchedule();
  const cache = new ReviewPageCache({ schedule });

  cache.set("k", ["old"], 0);
  cache.set("k", ["new"], 1000);
  assertEquals(drops[0].cancelled, true, "the old page's timer is called off");

  drops[0].run();
  assertEquals(cache.get("k", 1000), ["new"]);
  drops[1].run();
  assertEquals(cache.size, 0);
});

Deno.test("a page longer than a month's is read and let go, not kept", () => {
  const cache = new ReviewPageCache({ schedule: () => () => {} });
  cache.set("k", Array.from({ length: MAX_PAGE_ITEMS + 1 }, (_, i) => i), 0);

  assertEquals(cache.size, 0);
  assertEquals(cache.get("k", 1), undefined);
});

Deno.test("at most a dozen pages are held; the oldest goes first", () => {
  const cache = new ReviewPageCache({ schedule: () => () => {} });
  for (let i = 0; i <= MAX_PAGES; i += 1) {
    cache.set(`k${i}`, [i], i);
  }

  assertEquals(cache.size, MAX_PAGES);
  assertEquals(cache.get("k0", MAX_PAGES), undefined);
  assertEquals(cache.get(`k${MAX_PAGES}`, MAX_PAGES), [MAX_PAGES]);
});
