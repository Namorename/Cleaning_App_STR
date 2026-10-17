import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { redactText } from "./redact.ts";

// Synthetic texts and names only.

const NAMES = {
  guest: ["Anna Testová"],
  staff: ["Will Smithson", "Olga"],
  places: ["Test Flat A"],
};

Deno.test("names, contacts, codes and the place leave the text before it goes anywhere", () => {
  const text = "Thanks Peter! Anna Testová here. Will was great, we will come back. " +
    "Write to anna.t@example.com or +420 777 123 456, code 4821, see www.example.com " +
    "or @annat. Test Flat A was clean. OLGA left towels.";
  const out = redactText(text, NAMES);

  assertStringIncludes(out, "Thanks [NAME]!");
  assertStringIncludes(out, "[GUEST] [GUEST] here.");
  assertStringIncludes(out, "[STAFF] was great, we will come back.");
  assertStringIncludes(out, "[EMAIL]");
  assertStringIncludes(out, "[PHONE]");
  assertStringIncludes(out, "code [NUMBER]");
  assertStringIncludes(out, "[URL]");
  assertStringIncludes(out, "[NAME]. [PROPERTY] was clean.");
  assertStringIncludes(out, "[STAFF] left towels.");
  for (const leaked of ["Peter", "Anna", "Testová", "Will ", "4821", "example", "Olga", "OLGA"]) {
    assert(!out.includes(leaked), `"${leaked}" left in the text`);
  }
  assertEquals(redactText(out, NAMES), out, "redacting twice changes the text");
});

Deno.test("Czech and Russian greetings take the name after them", () => {
  assertEquals(redactText("Děkujeme Martino, vše super.", NAMES), "Děkujeme [NAME], vše super.");
  assertEquals(redactText("Спасибо Ивану за помощь.", NAMES), "Спасибо [NAME] за помощь.");
});
