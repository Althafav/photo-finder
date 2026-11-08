import { NextResponse, type NextRequest } from 'next/server';

// Optimistic check only — every admin API route verifies the signed cookie itself.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('ep_admin')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
