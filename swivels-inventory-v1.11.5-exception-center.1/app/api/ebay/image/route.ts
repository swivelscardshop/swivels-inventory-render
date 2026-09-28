import { NextResponse } from "next/server";
import { getListingImage } from "@/lib/ebay";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const itemId = new URL(request.url).searchParams.get("itemId") || "";
    const image = await getListingImage(itemId);
    return NextResponse.redirect(image, { status: 307, headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image failed" }, { status: 404 });
  }
}
