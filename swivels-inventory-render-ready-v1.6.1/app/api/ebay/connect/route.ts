import { NextResponse } from "next/server";
import { ebayAuthorizationUrl } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const state = crypto.randomUUID();
    const response = NextResponse.redirect(ebayAuthorizationUrl(state));
    response.cookies.set("ebay_oauth_state", state, {
      httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start eBay authorization";
    return NextResponse.redirect(new URL(`/?ebay_error=${encodeURIComponent(message)}`, request.url));
  }
}
