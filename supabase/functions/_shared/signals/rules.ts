/**
 * The rules' reading of a review, `rules-v1` (docs/reviews-to-tasks.md §3.1):
 * a strict dictionary in en, de, cs and ru — a failure word next to the thing
 * that failed, with a negation guard — measured on the live data of
 * 2026-10-17 (8.1 % of texts, against 13.2 % for a dictionary that also took
 * mere mentions). Free, and nothing leaves the function.
 *
 * The rules never write words: a finding carries a kind and a subject, the
 * screen names them from the locales, and a manager writes the title. They
 * never make a problem on their own (decide_signal_finding, rule 6), and
 * after the model they add a card only for a kind it said nothing of
 * (apply_signal_findings).
 */

import type { EvidenceSource, FindingInput, FindingKind, ReviewTexts, Subject } from "./types.ts";

export const RULES_DETECTOR = "rules-v1";

/** Above the default floor (0.60): a rules card waits for a manager, never dropped by itself. */
export const RULES_CONFIDENCE = 0.7;

/** How much of the text around a match goes with a card, either side. */
const EVIDENCE_MARGIN = 60;
const EVIDENCE_MAX = 200;
/** How far back a negation takes a match back ("nothing was broken"). */
const NEGATION_REACH = 25;

/** Word starts are anchored by hand: \b knows neither Cyrillic nor Czech letters. */
const B = "(?<![\\p{L}])";
const E = "(?![\\p{L}])";
const NOT_WORK = "(?:did ?n[o']t|does ?n[o']t|was ?n[o']t|were ?n[o']t|not)";

interface Rule {
  readonly kind: FindingKind;
  /** Null: a failure word with no object of its own — the subject is the thing named near it. */
  readonly subject: Subject | null;
  readonly roots: readonly string[];
}

const RULES: readonly Rule[] = [
  {
    kind: "repair",
    subject: "hot_water",
    roots: [
      "no (?:hot|warm) water",
      `hot water ${NOT_WORK}`,
      "kein(?:e|en)? (?:warm|heiß|heiss)wasser",
      "kein warmes wasser",
      "netekla tepl",
      "bez teplé vody",
      "nebyla teplá voda",
      "не было горячей",
      "нет горячей",
    ],
  },
  {
    kind: "repair",
    subject: "heating",
    roots: [
      "no heating",
      `heating ${NOT_WORK} work`,
      "keine heizung",
      "heizung (?:ging|funktionierte|funktioniert) nicht",
      "netopilo",
      "nefungovalo topení",
      "не работало отопление",
      "не было отопления",
    ],
  },
  {
    kind: "repair",
    subject: "plumbing_leak",
    roots: ["leak(?:ing|ed|s)?" + E, "undicht", "tropft", "kape" + E, "kapal", "протека", "теч[её]т"],
  },
  { kind: "repair", subject: "mould_damp", roots: ["mou?ld", "schimmel", "plíseň", "плесен"] },
  {
    kind: "repair",
    subject: "drain_toilet",
    roots: ["clogged", "blocked (?:drain|toilet|sink)", "verstopft", "ucpan", "засор"],
  },
  {
    kind: "repair",
    subject: "internet_tv",
    roots: [
      "no wi-?fi",
      "no internet",
      `wi-?fi ${NOT_WORK} work`,
      "kein (?:wlan|internet)",
      "nefungovala wi-?fi",
      "nefungoval internet",
      "не работал (?:wi-?fi|интернет)",
      "нет интернета",
    ],
  },
  {
    kind: "repair",
    subject: "electric",
    roots: ["no power", "no electricity", "kein strom", "nešel proud", "не было света", "нет света"],
  },
  {
    kind: "repair",
    subject: null,
    roots: [
      `${NOT_WORK} (?:work|working|function)`,
      "broken",
      "out of order",
      "funktioniert(?:e)? nicht",
      "ging nicht",
      "kaputt",
      "defekt",
      "nefungoval[aoy]?" + E,
      "nefunguje",
      "rozbit",
      "pokažen",
      "не работал[аио]?" + E,
      "не работает",
      "сломан",
    ],
  },
  {
    kind: "safety",
    subject: "electric",
    roots: ["electric shock", "stromschlag", "ударил[оа]? током", "kopl[ao]? proud"],
  },
  {
    kind: "safety",
    subject: "other",
    roots: [
      "gas smell",
      "smell(?:ed|s)? of gas",
      "gasgeruch",
      "zápach plynu",
      "запах газа",
      "smoke alarm",
      "rauchmelder",
    ],
  },
  {
    kind: "pests",
    subject: "other",
    roots: [
      "bed ?bugs?",
      "cockroach",
      "mice" + E,
      "mouse" + E,
      "rats?" + E,
      "ants" + E,
      "bettwanzen",
      "kakerlake",
      "mäuse",
      "štěnic",
      "šváb",
      "myši" + E,
      "клоп",
      "таракан",
      "мыши" + E,
    ],
  },
  {
    kind: "access",
    subject: "lock_door",
    roots: [
      `code ${NOT_WORK} work`,
      "could ?n[o']t (?:get|enter)",
      "locked out",
      "key ?box (?:did|was) ?n",
      "code funktionierte nicht",
      "kód nefung",
      "не могли (?:попасть|войти)",
      "код не (?:работ|подош)",
    ],
  },
  {
    kind: "cleaning",
    subject: "other",
    roots: [
      "dirty",
      "not clean",
      "hairs? (?:in|on)",
      "stains?" + E,
      "dusty",
      "schmutzig",
      "dreckig",
      "nicht sauber",
      "špinav",
      "nečist",
      "грязн",
      "пыльн",
      "волос",
    ],
  },
];

/** What a bare failure word was about, from the words around it. */
const DEVICES: readonly { readonly subject: Subject; readonly roots: readonly string[] }[] = [
  { subject: "heating", roots: ["heating", "heater", "radiator", "heizung", "topení", "radiátor", "отоплен", "батаре"] },
  { subject: "hot_water", roots: ["hot water", "warm water", "boiler", "warmwasser", "teplá voda", "bojler", "горяч", "бойлер"] },
  { subject: "air_conditioning", roots: ["air ?con", "a/c" + E, "klima", "кондиционер"] },
  {
    subject: "internet_tv",
    roots: ["wi-?fi", "internet", "tv" + E, "television", "fernseher", "wlan", "televiz", "телевиз", "интернет"],
  },
  {
    subject: "lock_door",
    roots: ["lock", "door", "key" + E, "schloss", "tür", "schlüssel", "zámek", "dveře", "klíč", "замок", "двер", "ключ"],
  },
  {
    subject: "electric",
    roots: ["light", "lamp", "socket", "power", "plug", "strom", "steckdose", "licht", "světlo", "zásuvk", "свет", "розетк", "ламп"],
  },
  {
    subject: "appliance",
    roots: [
      "fridge",
      "oven",
      "stove",
      "kettle",
      "dishwasher",
      "washing machine",
      "washer",
      "dryer",
      "microwave",
      "coffee",
      "kühlschrank",
      "backofen",
      "herd",
      "wasserkocher",
      "spülmaschine",
      "waschmaschine",
      "mikrowelle",
      "kaffee",
      "lednic",
      "troub",
      "konvic",
      "myčk",
      "pračk",
      "kávovar",
      "холодильник",
      "духовк",
      "плит",
      "чайник",
      "посудомо",
      "стиральн",
      "микроволнов",
      "кофе",
    ],
  },
  {
    subject: "window_blind",
    roots: ["window", "blind", "curtain", "shutter", "fenster", "jalousie", "rollladen", "okno", "okna", "žaluzi", "roleta", "окн", "жалюзи", "штор"],
  },
  {
    subject: "furniture",
    roots: ["bed" + E, "sofa", "couch", "chair", "table", "wardrobe", "drawer", "bett" + E, "stuhl", "tisch", "schrank", "postel", "gauč", "židle", "stůl", "skříň", "кроват", "диван", "стул", "стол", "шкаф"],
  },
  {
    subject: "drain_toilet",
    roots: ["toilet", "drain", "flush", "wc" + E, "toilette", "spülung", "záchod", "splach", "унитаз", "слив"],
  },
  {
    subject: "plumbing_leak",
    roots: ["tap" + E, "faucet", "sink", "shower", "wasserhahn", "dusche", "waschbecken", "kohoutek", "sprch", "umyvadl", "кран", "душ", "раковин"],
  },
];

const NEGATION = /(?<![\p{L}])(?:no|nothing|never|kein|keine|nichts|nic|žádn\p{L}*|ничего|никаких)(?![\p{L}])/iu;

function compile(roots: readonly string[]): RegExp[] {
  return roots.map((root) => new RegExp(`${B}${root}`, "iu"));
}

const COMPILED_RULES = RULES.map((rule) => ({ ...rule, patterns: compile(rule.roots) }));
const COMPILED_DEVICES = DEVICES.map((device) => ({ ...device, patterns: compile(device.roots) }));

interface Hit {
  readonly index: number;
  readonly length: number;
}

/** The first match of a pattern no negation just before it takes back. */
function firstUnnegated(text: string, pattern: RegExp): Hit | null {
  const global = new RegExp(pattern.source, "giu");
  for (const match of text.matchAll(global)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - NEGATION_REACH), index);
    if (!NEGATION.test(before)) {
      return { index, length: match[0].length };
    }
  }
  return null;
}

function deviceNear(text: string, index: number, length: number): Subject {
  const window = text.slice(Math.max(0, index - 40), Math.min(text.length, index + length + 40));
  for (const device of COMPILED_DEVICES) {
    if (device.patterns.some((pattern) => pattern.test(window))) {
      return device.subject;
    }
  }
  return "other";
}

/** The text around a match, cut at spaces: a fragment of the stored text, as it is there. */
function fragment(text: string, index: number, length: number): string {
  let start = Math.max(0, index - EVIDENCE_MARGIN);
  let end = Math.min(text.length, index + length + EVIDENCE_MARGIN);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space !== -1 && space < index ? space + 1 : start;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > index + length ? space : end;
  }
  return text.slice(start, end).trim().slice(0, EVIDENCE_MAX);
}

interface Segment {
  readonly text: string;
  readonly source: EvidenceSource;
}

function segments(texts: ReviewTexts): Segment[] {
  const list: Segment[] = [];
  if (texts.publicText !== null) list.push({ text: texts.publicText, source: "public" });
  if (texts.privateText !== null) list.push({ text: texts.privateText, source: "private" });
  for (const comment of Object.values(texts.categoryComments)) {
    list.push({ text: comment, source: "category_comment" });
  }
  return list;
}

/**
 * The rules' findings in one review: one card a kind and subject, the first
 * place it is said. A bare failure word takes the subject of the thing named
 * near it; it adds nothing to a kind that already has a named subject.
 */
export function readByRules(texts: ReviewTexts): FindingInput[] {
  const found = new Map<string, FindingInput>();

  for (const segment of segments(texts)) {
    for (const rule of COMPILED_RULES) {
      for (const pattern of rule.patterns) {
        const hit = firstUnnegated(segment.text, pattern);
        if (hit === null) {
          continue;
        }
        const subject = rule.subject ?? deviceNear(segment.text, hit.index, hit.length);
        const key = `${rule.kind}/${subject}`;
        if (!found.has(key)) {
          found.set(key, {
            kind: rule.kind,
            subject,
            urgency: rule.kind === "safety" ? "high" : "normal",
            still_relevant: "unclear",
            summary_i18n: {},
            evidence: fragment(segment.text, hit.index, hit.length),
            evidence_source: segment.source,
            confidence: RULES_CONFIDENCE,
          });
        }
        break;
      }
    }
  }

  const findings = [...found.values()];
  const named = new Set(findings.filter((f) => f.subject !== "other").map((f) => f.kind));
  return findings.filter((f) => f.subject !== "other" || !named.has(f.kind));
}
