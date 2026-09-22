const url = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function supabaseConfigured() {
  return Boolean(url() && key());
}

export async function db(path: string, init: RequestInit = {}) {
  if (!supabaseConfigured()) throw new Error("Supabase environment variables are missing");
  const response = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function count(table: string, filter = "") {
  if (!supabaseConfigured()) return 0;
  const response = await fetch(`${url()}/rest/v1/${table}?select=id${filter}`, {
    cache: "no-store",
    headers: {
      apikey: key(), Authorization: `Bearer ${key()}`,
      Prefer: "count=exact", Range: "0-0",
    },
  });
  if (!response.ok) throw new Error(`Could not count ${table}: ${await response.text()}`);
  const range = response.headers.get("content-range") || "0/0";
  return Number(range.split("/")[1] || 0);
}
