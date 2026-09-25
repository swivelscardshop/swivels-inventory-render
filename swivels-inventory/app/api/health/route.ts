export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "swivels-inventory",
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
