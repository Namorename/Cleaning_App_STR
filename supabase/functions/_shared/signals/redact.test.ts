import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { hasUsableName, redactText } from "./redact.ts";

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

Deno.test("a name goes in every part, ending and spelling a guest gives it", () => {
  const names = {
    guest: ["Kateřina Dvořáková", "Marek Novák", "Мария Иванова", "Eva"],
    staff: ["Hanka", "Petr", "Olga"],
    places: [],
  };
  const text = [
    "Kateřino, díky! Dvořákové se líbilo, Dvorakova taky. KATEŘINA.",
    "Markovi a Nováka jsme potkali, Novákovi děkujeme, Nováková ok.",
    "Спасибо от Марии и Ивановой, Марией довольны.",
    "S Evou jsme byli spokojeni, Evě se líbilo.",
    "Olze, Hance a Petře díky, Petrovi taky.",
  ].join(" ");
  const out = redactText(text, names);

  for (
    const leaked of [
      "Kateř", "Dvoř", "Dvorak", "KATE", "Mark", "Novák", "Мари", "Иванов", "Evou", "Evě",
      "Olz", "Hanc", "Petř", "Petr",
    ]
  ) {
    assert(!out.includes(leaked), `"${leaked}" left in the text`);
  }
  assertStringIncludes(out, "[GUEST], díky!");
  assertStringIncludes(out, "[STAFF], [STAFF] a [STAFF] díky");
  assertEquals(redactText(out, names), out, "redacting twice changes the text");
});

Deno.test("the forms of a name never take ordinary words in lower case", () => {
  const names = { guest: ["Eva Market", "Will", "will smith"], staff: [], places: [] };
  const text = "we will come back, the market was near, even so.";
  assertEquals(redactText(text, names), text);
});

Deno.test("a name the PMS writes in capitals, with odd marks or another composition still goes", () => {
  const nfd = "Nováková".normalize("NFD");
  const names = { guest: ["ANNA NOVÁKOVÁ", "Petra/Tom (Ann)", `Jana ${nfd}`, "Łukasz"], staff: [], places: [] };
  const text = [
    "Anna and Nováková, Novakova too.",
    "Petra, Tom and Ann.",
    `Jana ${"Novákové"} and ${"Novákové".normalize("NFD")}.`,
    "Łukasz and Lukasz.",
  ].join(" ");
  const out = redactText(text, names);
  for (const leaked of ["Anna", "Novák", "Novak", "Petra", "Tom", "Ann", "Jana", "ukasz"]) {
    assert(!out.includes(leaked), `"${leaked}" left in the text`);
  }
});

Deno.test("the declined forms of Czech, Polish and Ukrainian names go too", () => {
  const names = {
    guest: ["Jiří Novotný", "Jan Kowalski", "Марія Іван", "Олена Dvořákovi"],
    staff: [],
    places: [],
  };
  const text = "Jiřího a Novotného, Novotnému díky. Kowalskiego, Kowalskiemu. " +
    "Марії, Марією, Іванові, Олені, Олено. Dvořákových, Dvořákovými.";
  const out = redactText(text, names);
  for (const leaked of ["Jiř", "Novotn", "Kowalsk", "Марі", "Іван", "Олен", "Dvořák"]) {
    assert(!out.includes(leaked), `"${leaked}" left in the text`);
  }
});

Deno.test("a name of no letters is no name: nothing to take out", () => {
  assertEquals(hasUsableName([]), false);
  assertEquals(hasUsableName(["-", "?", "J.", " "]), false);
  assertEquals(hasUsableName(["-", "Jo"]), true);
});

Deno.test("Czech and Russian greetings take the name after them", () => {
  assertEquals(redactText("Děkujeme Martino, vše super.", NAMES), "Děkujeme [NAME], vše super.");
  assertEquals(redactText("Спасибо Ивану за помощь.", NAMES), "Спасибо [NAME] за помощь.");
});
