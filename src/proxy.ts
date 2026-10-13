import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Optimistic gate only: sends visitors without any session cookie to the sign-in page and keeps
 * Supabase sessions refreshed. Real authorization happens server-side in every admin page,
 * server action and API route (see src/lib/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  const provider = process.env.AUTH_PROVIDER ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local");
  let response = NextResponse.next({ request });
  let hasSession = false;
  if (provider === "supabase") {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    hasSession = Boolean(data.user);
  } else {
    hasSession = Boolean(request.cookies.get("qoc_session")?.value);
  }
  if (!hasSession) {
    if (pathname.startsWith("/api/admin")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
