import type { CatalogCategory } from '../problems/categories';

/**
 * A company's catalogue of task categories for tests: the 27 of the first client as they were
 * written (docs/one-off-writes/wagner-problem-categories.sql, 2026-11-15) — names in the company's
 * language, translations, synonyms, and the levels P1 critical, P2 high, P3 normal, P4 low —
 * in the order the server hands them (sort_order). Test data only: no app imports it.
 */

type Level = 'P1' | 'P2' | 'P3' | 'P4';

const STORED: Readonly<Record<Level, Pick<CatalogCategory, 'priority' | 'critical'>>> = {
  P1: { priority: 'high', critical: true },
  P2: { priority: 'high', critical: false },
  P3: { priority: 'normal', critical: false },
  P4: { priority: 'low', critical: false },
};

function row(
  id: string,
  level: Level,
  name: string,
  en: string,
  cs: string,
  synonyms: readonly string[] = [],
): CatalogCategory {
  return { id, name, name_i18n: { en, cs }, synonyms, ...STORED[level] };
}

export const CATALOG_FIXTURE: readonly CatalogCategory[] = [
  row('83ffda56-635c-4941-bedd-cb08b82e6675', 'P1', 'Горячая вода', 'Hot water', 'Teplá voda', ['бойлер']),
  row('d62b476c-b82e-4d8a-90e9-d414597c1279', 'P1', 'Отопление', 'Heating', 'Topení', ['батарея', 'радиатор']),
  row('a1ca0593-1f46-4f4a-9229-d2b85f31cdd1', 'P1', 'Доступ в квартиру', 'Access to the apartment', 'Přístup do bytu', ['ключ', 'домофон', 'вход', 'дверь']),
  row('37659104-f5d6-4596-bb00-01130bc371cb', 'P1', 'Электричество полностью', 'Total power outage', 'Úplný výpadek elektřiny', ['свет']),
  row('f5093c0c-58db-42bb-b5dc-ed6f5daa550c', 'P1', 'Прорыв труб', 'Burst pipe', 'Prasklé potrubí', ['труба']),
  row('d2e00844-d88c-4324-ab60-dbed5bb56a59', 'P1', 'Затопление', 'Flooding', 'Zatopení', ['потоп', 'протечка', 'залив']),
  row('2ca940fd-288f-43f5-a6df-93145e10cd67', 'P2', 'Wi-Fi', 'Wi-Fi', 'Wi-Fi', ['wifi', 'вайфай', 'вай-фай', 'интернет', 'internet', 'роутер']),
  row('bacca1bc-6f84-4c28-87f7-78f703bada4d', 'P2', 'Кондиционер', 'Air conditioning', 'Klimatizace', ['кондер', 'кондей']),
  row('9293427f-b55f-4710-9d8b-51b0a2cdd79e', 'P2', 'Холодильник', 'Fridge', 'Lednice', ['морозилка']),
  row('6268cb20-21c5-466b-8c25-3c597eb08502', 'P2', 'Плита', 'Stove', 'Sporák', ['духовка', 'конфорка']),
  row('f530619c-43e8-4f38-a187-85498c28c053', 'P2', 'Душ', 'Shower', 'Sprcha', ['лейка']),
  row('46d47fc5-72f2-46f7-a63c-2a7227dd6aca', 'P2', 'Частичное отсутствие электричества', 'Partial power outage', 'Částečný výpadek elektřiny', ['свет', 'розетка']),
  row('91292260-09af-497a-9d37-0d2b5b9094b2', 'P2', 'Сантехника', 'Plumbing', 'Vodoinstalace', ['унитаз', 'раковина', 'ванна']),
  row('56e19d08-d142-4083-8b02-961546a1d6f2', 'P3', 'Освещение', 'Lighting', 'Osvětlení', ['свет', 'лампа', 'люстра']),
  row('3cfd7ee1-4078-40dc-8d06-4b75ee250180', 'P3', 'Мелкая бытовая техника', 'Small appliances', 'Drobné spotřebiče', ['чайник', 'фен', 'утюг', 'микроволновка', 'кофеварка', 'пылесос', 'тостер']),
  row('ddc74d9b-6388-49ee-9bb2-6611f951db6b', 'P3', 'Мебель', 'Furniture', 'Nábytek', ['стул', 'стол', 'шкаф', 'кровать', 'диван']),
  row('1744627c-58f8-4682-ac8d-9a3648f16b5c', 'P3', 'Замки межкомнатных дверей', 'Interior door locks', 'Zámky vnitřních dveří', ['замок', 'дверь', 'ручка']),
  row('8b4e8b0d-3fec-4833-8c79-80416c5cd97a', 'P3', 'Засоры', 'Clogged drains', 'Ucpané odpady', ['слив', 'канализация']),
  row('7bed8f05-ae67-43c3-82d5-01bf1b4a26c6', 'P3', 'Смесители', 'Taps', 'Vodovodní baterie', ['кран', 'смеситель']),
  row('7a2fa5c7-6688-4658-b898-17a6bad801a8', 'P4', 'Косметические дефекты', 'Cosmetic defects', 'Kosmetické vady'),
  row('22168888-b535-420d-937f-5acd1bfe0661', 'P4', 'Царапины', 'Scratches', 'Škrábance', ['царапина']),
  row('e80960c4-e5fe-47b7-94b0-2cefda65e660', 'P4', 'Покраска стен', 'Wall painting', 'Malování stěn', ['стена', 'краска']),
  row('0e170fe9-4973-48fb-bc0b-23f548340527', 'P4', 'Декор', 'Decor', 'Dekorace'),
  row('b9a0f74f-0535-4b71-aa15-8a946b25150f', 'P4', 'Замена мебели', 'Furniture replacement', 'Výměna nábytku'),
  row('550e8872-7829-4235-8016-9c1040d0c3ab', 'P4', 'Дополнительные аксессуары', 'Extra accessories', 'Doplňkové vybavení'),
  row('b1d15e3f-5d86-45ad-845d-e339b05a373a', 'P4', 'Баки', 'Bins', 'Popelnice'),
  row('53254afb-447f-46df-ac19-e265389a9d9b', 'P4', 'Доставка (бельё, химия, кроватка и т. д.)', 'Delivery (linen, cleaning supplies, cot, etc.)', 'Dovoz (prádlo, drogerie, postýlka atd.)', ['полотенца']),
];

/** What a person types into the search, for the tests that hold both apps to the same answers. */
export const SEARCH_CASES: readonly { readonly query: string; readonly note: string }[] = [
  { query: '', note: 'nothing typed keeps them all' },
  { query: 'элек', note: 'the first letters of any word of a name' },
  { query: 'ЭЛЕК', note: 'case aside' },
  { query: 'гор вод', note: 'several words, each the start of one' },
  { query: 'вод гор', note: 'in any order' },
  { query: 'кран', note: 'a synonym' },
  { query: 'свет', note: 'a synonym of several categories' },
  { query: 'белье', note: 'е finds ё' },
  { query: 'бельё', note: 'ё finds ё' },
  { query: 'ёлка', note: 'nothing found' },
  { query: 'wifi', note: 'a name run together' },
  { query: 'wi fi', note: 'the words of a name with punctuation' },
  { query: 'вай-фай', note: 'a synonym with a hyphen' },
  { query: 'flood', note: 'a translation' },
  { query: 'teplá', note: 'a translation with a diacritic' },
  { query: 'tepla', note: 'diacritics aside' },
  { query: 'ода', note: 'the middle of a word finds nothing' },
  { query: '  замок  ', note: 'spaces around' },
  { query: 'замен меб', note: 'two words of one name' },
  { query: '(бельё,', note: 'punctuation typed' },
];
