import { assert, assertStringIncludes } from "jsr:@std/assert@1";

import { ALPHABET, STAGED_PASSWORD } from "../_shared/staff-password.ts";

/**
 * The letter and the code that fills it have to name the same key.
 *
 * Nothing else checks this. `manage-staff` stages the password in
 * user_metadata and asks auth to post the Recovery template; auth renders it
 * with Go's `html/template`, which prints a missing key as nothing at all and
 * reports no error. The result is a letter that arrives, looks right, and is
 * empty where the password should be — which is what came back from the first
 * run on a real phone. Renaming the constant, or editing the template by hand,
 * would do it again just as quietly.
 */

const templateText = await Deno.readTextFile(
  new URL("../../templates/recovery.html", import.meta.url),
);

const configText = await Deno.readTextFile(
  new URL("../../config.toml", import.meta.url),
);

Deno.test("the letter prints the key the function stages the password under", () => {
  assertStringIncludes(templateText, `{{ .Data.${STAGED_PASSWORD} }}`);
});

Deno.test("the letter names the login, which is the address auth sends it to", () => {
  assertStringIncludes(templateText, "{{ .Email }}");
});

Deno.test("the local stack renders this same file, not a template of its own", () => {
  assertStringIncludes(configText, "[auth.email.template.recovery]");
  assertStringIncludes(configText, 'content_path = "./supabase/templates/recovery.html"');
});

Deno.test("no character of a password can be mangled by rendering it as HTML", () => {
  // The alphabet is chosen so this holds (see staff-password.ts), and the
  // letter is where it would show: `&amp;` on screen is a password nobody can
  // type, and it would read as "the password is wrong" rather than as a bug.
  const escaped = ["&", "<", ">", '"', "'"];

  assert(
    escaped.every((character) => !ALPHABET.includes(character)),
    `password alphabet holds an HTML-escaped character: ${ALPHABET}`,
  );
});
