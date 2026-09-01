// Прогон SQL-тестов. Запуск: npm run test:rls
//
// Гоняет все наборы из supabase/tests/*.sql по очереди, каждый — отдельным
// вызовом psql. Раньше файл был один и его имя стояло константой; когда
// появился второй набор, оказалось, что добавить его некуда, а переименовывать
// команду нельзя — на неё ссылается CLAUDE.md и мышечная память.
//
// Имя контейнера выводится из project_id в supabase/config.toml — хардкод
// вида supabase_db_azpvpzqkseluzbtlnlkb работал бы только на машине автора
// и падал бы с "No such container" у любого, кто переименует проект.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG = "supabase/config.toml";
const SUITE_DIR = "supabase/tests";

const projectId = readFileSync(CONFIG, "utf8").match(/^project_id\s*=\s*"([^"]+)"/m);
if (!projectId) {
  console.error(`Не найден project_id в ${CONFIG}`);
  process.exit(1);
}

const container = `supabase_db_${projectId[1]}`;

const suites = readdirSync(SUITE_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (suites.length === 0) {
  console.error(`Нет наборов в ${SUITE_DIR}`);
  process.exit(1);
}

let failed = 0;

for (const suite of suites) {
  const path = join(SUITE_DIR, suite);
  console.log(`\n--- ${suite} ---`);

  const res = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
     "-v", "ON_ERROR_STOP=1", "-q"],
    {
      input: readFileSync(path, "utf8"),
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
    console.error(`Набор ${suite} не прошёл (код ${res.status}).`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\nНе прошло наборов: ${failed}. Контейнер: ${container}`);
  console.error("Стек поднят? npm run db:start");
  process.exit(1);
}

console.log(`\nВсе наборы пройдены (${suites.length}).`);
