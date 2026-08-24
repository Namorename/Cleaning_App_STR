// Генерация типов БД.
//
// Через `supabase gen types ... > file` делать нельзя: и cmd.exe, и sh
// обрезают файл ДО запуска команды, поэтому упавший CLI (не поднят Docker,
// база перезапускается) оставляет на диске пустой database.types.ts.
// Здесь вывод сначала собирается в память и пишется только при успехе.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = "packages/shared/src/database.types.ts";
const MARKER = "export type Database";

// shell: true обязателен на Windows — начиная с Node 20 spawn отказывается
// запускать .cmd напрямую (EINVAL). Аргументы фиксированы и без пробелов,
// так что склейка через shell безопасна.
const child = spawn(
  "npx",
  ["supabase", "gen", "types", "typescript", "--local"],
  { stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" },
);

let out = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => (out += chunk));

child.on("error", (err) => {
  console.error(`Не удалось запустить supabase CLI: ${err.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`supabase gen types завершился с кодом ${code}; ${OUT} не тронут.`);
    process.exit(code ?? 1);
  }
  // CLI может выйти с нулём, отдав пустой или частичный вывод.
  if (!out.includes(MARKER)) {
    console.error(`Вывод не похож на типы (нет "${MARKER}"); ${OUT} не тронут.`);
    process.exit(1);
  }
  writeFileSync(OUT, out, "utf8");
  console.log(`${OUT} обновлён (${out.length} байт)`);
});
