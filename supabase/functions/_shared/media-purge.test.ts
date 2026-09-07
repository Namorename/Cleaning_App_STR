import { assertEquals } from "jsr:@std/assert@1";
import { chunk, purgeFiles, type PurgeRow, type StorageRemover } from "./media-purge.ts";

function rows(count: number): PurgeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    storage_path: `host/task/${index}.jpg`,
  }));
}

Deno.test("chunk splits a list into parts of the given size", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
});

Deno.test("every row of an accepted chunk is settled", async () => {
  const removed: string[][] = [];
  const storage: StorageRemover = {
    remove(paths) {
      removed.push(paths);
      return Promise.resolve({ error: null });
    },
  };

  const outcome = await purgeFiles(rows(5), storage, 2);

  assertEquals(removed, [
    ["host/task/0.jpg", "host/task/1.jpg"],
    ["host/task/2.jpg", "host/task/3.jpg"],
    ["host/task/4.jpg"],
  ]);
  assertEquals(outcome.purgedIds, ["id-0", "id-1", "id-2", "id-3", "id-4"]);
  assertEquals(outcome.failures, []);
});

Deno.test("a refused chunk settles none of its rows and does not stop the rest", async () => {
  let call = 0;
  const storage: StorageRemover = {
    remove() {
      call += 1;
      return Promise.resolve(
        call === 1 ? { error: { message: "storage is having a day" } } : { error: null },
      );
    },
  };

  const outcome = await purgeFiles(rows(3), storage, 2);

  assertEquals(outcome.purgedIds, ["id-2"]);
  assertEquals(outcome.failures, ["2 files: storage is having a day"]);
});
