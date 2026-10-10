import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { privacyLanguageOf } from '@/app/privacy/language';
import { publicEnv } from '@/lib/env';
import { PAGE_LANGUAGE_HEADER } from '@/lib/page-language';
import { isPanelRole, roleOf } from '@/lib/session';

const PUBLIC_PATHS = ['/login'];

/**
 * Pages for everyone, signed in or not, and nobody is sent away from them
 * (decision 17, docs/f11-plan.md: the privacy policy App Store Connect links
 * to). Unlike the sign-in page, a manager stays on them too. Exact paths only:
 * `/privacyx` and `/privacy/x` are the panel's like any other address.
 *
 * Each speaks the language of its own address, not the panel's cookie: the
 * reader here is the page's own, so <html lang> and the page cannot disagree.
 */
const OPEN_PATHS: ReadonlyMap<string, (searchParams: URLSearchParams) => string> = new Map([
  ['/privacy', privacyLanguageOf],
]);

/**
 * A redirect that still carries the session cookies.
 *
 * Refresh tokens rotate: the moment getUser() exchanged one, the browser's
 * copy died. The rotated pair sits on the pass-through response; a redirect
 * that forgot to copy it would sign the manager out on the next request.
 */
function redirectKeepingCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

/**
 * Runs before every page: keeps the Supabase session fresh and sends anyone
 * who is not a manager to the sign-in page — every page but the open ones.
 *
 * The guard here is convenience, not security — row level security decides
 * what the browser may read either way. The redirect keeps a cleaner who
 * opens the panel by mistake from seeing an empty shell.
 */
export async function proxy(request: NextRequest) {
  // No session to keep fresh and no one to redirect: Auth is not asked at all.
  // The page's language goes on to the root layout, for <html lang>.
  const pageLanguage = OPEN_PATHS.get(request.nextUrl.pathname);
  if (pageLanguage !== undefined) {
    const headers = new Headers(request.headers);
    headers.set(PAGE_LANGUAGE_HEADER, pageLanguage(request.nextUrl.searchParams));
    return NextResponse.next({ request: { headers } });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
  });

  // getUser() validates the token against Auth; getSession() would trust the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isManager = isPanelRole(roleOf(user));

  if (!isManager && !isPublic) {
    // The way back is the whole address: a bookmarked `/calendar?assignee=nobody`
    // must open filtered after the sign-in. The sign-in page itself keeps
    // nothing of the query but that; `safeNext` checks it on the way out.
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return redirectKeepingCookies(url, response);
  }

  if (isManager && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return redirectKeepingCookies(url, response);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
