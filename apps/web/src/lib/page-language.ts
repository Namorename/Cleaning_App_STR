/**
 * The request header that names the language a page is written in, when that
 * is the page's own and not the panel's cookie: the public privacy policy
 * speaks the language of its address (`app/privacy/language.ts`). The proxy
 * sets it for that page; the root layout puts it on <html lang>.
 *
 * Free of any import, so the proxy does not carry the dictionaries. A browser
 * that sends the header itself changes only its own page's `lang`, and only to
 * a language the panel speaks.
 */
export const PAGE_LANGUAGE_HEADER = 'x-page-lang';
