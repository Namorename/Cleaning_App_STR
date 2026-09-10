import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import { isPanelRole, roleOf } from '@/lib/session';

const PUBLIC_PATHS = ['/login'];

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
 * who is not a manager to the sign-in page.
 *
 * The guard here is convenience, not security — row level security decides
 * what the browser may read either way. The redirect keeps a cleaner who
 * opens the panel by mistake from seeing an empty shell.
 */
export async function proxy(request: NextRequest) {
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

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isManager = isPanelRole(roleOf(user));

  if (!isManager && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
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
