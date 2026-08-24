// Прогон дымового теста RLS.
//
// Имя контейнера выводится из project_id в supabase/config.toml — хардкод
// вида supabase_db_azpvpzqkseluzbtlnlkb работал бы только на машине автора
// и падал бы с "No such container" у любого, кто переименует проект.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CONFIG = "supabase/config.toml";
const SUITE = "supabase/tests/rls_smoke.sql";

const projectId = readFileSync(CONFIG, "utf8").match(/^project_id\s*=\s*"([^"]+)"/m);
if (!projectId) {
  console.error(`Не найден project_id в ${CONFIG}`);
  process.exit(1);
}

const container = `supabase_db_${projectId[1]}`;

const res = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
   "-v", "ON_ERROR_STOP=1", "-q"],
  {
    input: readFileSync(SUITE, "utf8"),
    encoding: "utf8",
    shell: process.platform === "win32",
  },
);

if (res.error) {
  console.error(`Не удалось запустить docker: ${res.error.message}`);
  process.exit(1);
}

// psql пишет NOTICE в stderr, поэтому разбираем объединённый поток.
const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
for (const line of out.split("\n")) {
  if (/NOTICE:|ERROR:|FAIL/.test(line)) {
    console.log(line.replace(/^NOTICE:\s*/, "").trimEnd());
  }
}

if (res.status !== 0 || /ERROR:|FAIL/.test(out)) {
  console.error(`\nТест RLS не прошёл (код ${res.status}). Контейнер: ${container}`);
  console.error("Стек поднят? npm run db:start");
  process.exit(1);
}

console.log("\nВсе проверки RLS пройдены.");
