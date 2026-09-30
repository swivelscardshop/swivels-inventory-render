import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@/lib/ebay";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.cookies.delete("ebay_oauth_state");
    return response;
  };
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expected = request.cookies.get("ebay_oauth_state")?.value;
    const denied = request.nextUrl.searchParams.get("error_description") || request.nextUrl.searchParams.get("error");
    if (denied) throw new Error(denied);
    if (!code || !state || !expected || state !== expected) throw new Error("eBay authorization could not be verified. Please try Connect eBay again.");
    const refreshToken = await exchangeAuthorizationCode(code);
    await db("app_secrets?on_conflict=key", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "ebay_refresh_token", value: refreshToken, updated_at: new Date().toISOString() }),
    });
    return finish("/?ebay=connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay authorization failed";
    return finish(`/?ebay_error=${encodeURIComponent(message)}`);
  }
}
