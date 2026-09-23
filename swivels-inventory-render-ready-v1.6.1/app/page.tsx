"use client";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  Copy,
  Download,
  FileUp,
  LayoutDashboard,
  MapPin,
  Menu,
  PackageCheck,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
type View =
  | "dashboard"
  | "inventory"
  | "orders"
  | "duplicates"
  | "intake"
  | "sync"
  | "settings";
type Status = {
  ready: boolean;
  ebayConfigured: boolean;
  ebayAppConfigured?: boolean;
  supabaseConfigured: boolean;
  listings?: number;
  physical?: number;
  orders?: number;
  issues?: number;
  lastSync?: string | null;
  orderRows?: any[];
  error?: string;
};
type Listing = {
  id: string;
  ebay_listing_id: string;
  ebay_sku: string | null;
  title: string;
  game: string;
  set_name: string | null;
  price: number | null;
  ebay_quantity: number;
  physical_skus: any[];
};
const nav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["inventory", "Inventory", Boxes],
  ["orders", "Orders", ShoppingBag],
  ["duplicates", "Duplicate Center", Copy],
  ["intake", "CSV Intake", FileUp],
  ["sync", "Sync Status", RefreshCw],
  ["settings", "Settings", Settings],
] as const;
export default function Home() {
  const [view, setView] = useState<View>("dashboard"),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState<Status>({
      ready: false,
      ebayConfigured: false,
      supabaseConfigured: false,
    }),
    [inventory, setInventory] = useState<Listing[]>([]),
    [orders, setOrders] = useState<any[]>([]),
    [duplicateGroups, setDuplicateGroups] = useState<any[]>([]),
    [intake, setIntake] = useState<any>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const s: any = await fetch("/api/status", { cache: "no-store" }).then((r) =>
      r.json(),
    );
    setStatus(s);
  }, []);
  const loadInventory = useCallback(
    async (search: string, currentPage: number) => {
      setLoading(true);
      try {
        const b: any = await fetch(
          `/api/inventory?q=${encodeURIComponent(search)}&page=${currentPage}&pageSize=50`,
          { cache: "no-store" },
        ).then((r) => r.json());
        if (b.error) throw new Error(b.error);
        setInventory(b.rows || []);
        setTotal(b.total || 0);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Inventory failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const b: any = await fetch("/api/orders", { cache: "no-store" }).then(
        (r) => r.json(),
      );
      if (b.error) throw new Error(b.error);
      setOrders(b.rows || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Orders failed");
    } finally {
      setLoading(false);
    }
  }, []);
  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const b: any = await fetch("/api/duplicates", { cache: "no-store" }).then(
        (r) => r.json(),
      );
      if (b.error) throw new Error(b.error);
      setDuplicateGroups(b.groups || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Duplicate scan failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("ebay") === "connected")
      setMessage(
        "eBay connected. You can now import your real listings and orders.",
      );
    if (p.get("ebay_error")) setMessage(p.get("ebay_error") || "");
    load().catch((e) => setMessage(e.message));
  }, [load]);
  useEffect(() => {
    if (view !== "inventory" || !status.ready) return;
    const timer = setTimeout(() => loadInventory(q, page), q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [view, status.ready, q, page, loadInventory]);
  useEffect(() => {
    if (view === "orders" && status.ready) loadOrders();
  }, [view, status.ready, loadOrders]);
  useEffect(() => {
    if (view === "duplicates" && status.ready) loadDuplicates();
  }, [view, status.ready, loadDuplicates]);
  const sync = async () => {
    if (
      !confirm(
        "Import current active listings and open orders from eBay into the fresh Supabase database? This reads eBay only and will NOT change any eBay listing.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Sync failed");
      setMessage(
        b.warning ||
          `Imported ${b.listings.toLocaleString()} active listings and ${b.orders.toLocaleString()} order lines.`,
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shell">
      <aside className={mobile ? "open" : ""}>
        <div className="logo">
          <span>◓</span>
          <div>
            <b>SWIVELS</b>
            <small>INVENTORY</small>
          </div>
          <button onClick={() => setMobile(false)}>
            <X />
          </button>
        </div>
        <nav>
          {nav.map(([id, label, I]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setMobile(false);
              }}
            >
              <I />
              <span>{label}</span>
              {id === "orders" && Boolean(status.orders) && (
                <i>{status.orders}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="master">
          <Store />
          <div>
            <small>MASTER SOURCE</small>
            <b>eBay</b>
            <em>
              {status.ebayConfigured ? "● OAuth connected" : "○ Not connected"}
            </em>
          </div>
        </div>
        <div className="profile">
          <span>SC</span>
          <div>
            <b>Swivels</b>
            <small>Card Shop</small>
          </div>
        </div>
      </aside>
      {mobile && <button className="scrim" onClick={() => setMobile(false)} />}
      <main>
        <header>
          <button className="menubtn" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <div>
            <small>SWIVELS CARD SHOP</small>
            <h1>{nav.find((x) => x[0] === view)?.[1]}</h1>
          </div>
          <div className="head">
            <span>
              {status.lastSync
                ? `Last eBay import ${new Date(status.lastSync).toLocaleString()}`
                : "Never imported"}
            </span>
            {status.ebayConfigured ? (
              <button
                className="primary"
                disabled={busy || !status.ready}
                onClick={sync}
              >
                <RefreshCw className={busy ? "spin" : ""} />
                {busy ? "Importing…" : "Import from eBay"}
              </button>
            ) : (
              <a className="primary" href="/api/ebay/connect">
                Connect eBay
              </a>
            )}
          </div>
        </header>
        <div className="content">
          {message && <div className="notice">{message}</div>}
          {status.error && (
            <div className="warning">
              <AlertTriangle />
              <div>
                <b>Setup required</b>
                <p>{status.error}</p>
              </div>
            </div>
          )}
          {view === "dashboard" && <Dashboard s={status} go={setView} />}{" "}
          {view === "inventory" && (
            <Inventory
              rows={inventory}
              q={q}
              setQ={(v) => {
                setQ(v);
                setPage(1);
              }}
              page={page}
              setPage={setPage}
              total={total}
              loading={loading}
            />
          )}{" "}
          {view === "orders" && <Orders rows={orders} loading={loading} />}{" "}
          {view === "duplicates" && (
            <Duplicates
              groups={duplicateGroups}
              loading={loading}
              reload={loadDuplicates}
              setMessage={setMessage}
            />
          )}{" "}
          {view === "intake" && (
            <CsvIntake
              data={intake}
              setData={setIntake}
              setMessage={setMessage}
            />
          )}{" "}
          {view === "sync" && <Sync s={status} busy={busy} sync={sync} />}{" "}
          {view === "settings" && <Connections s={status} />}
        </div>
      </main>
    </div>
  );
}
function Intro({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="intro">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({ n, t, d }: { n: number | string; t: string; d: string }) {
  return (
    <article>
      <Store />
      <div>
        <small>{t}</small>
        <b>{typeof n === "number" ? n.toLocaleString() : n}</b>
        <em>{d}</em>
      </div>
    </article>
  );
}
function Dashboard({ s, go }: { s: Status; go: (v: View) => void }) {
  const connected = s.ready && s.ebayConfigured;
  return (
    <>
      <Intro
        title="eBay is the master. Supabase stores the working catalog."
        text="All numbers below come from your connected Supabase project."
        action={
          <span className={connected ? "healthy" : "count"}>
            {connected ? (
              <>
                <Check /> Ready for eBay import
              </>
            ) : (
              "Setup incomplete"
            )}
          </span>
        }
      />
      <div className="metrics">
        <Metric
          n={s.listings || 0}
          t="Active eBay listings"
          d="Imported master catalog"
        />
        <Metric
          n={s.physical || 0}
          t="Physical SKU locations"
          d="Stored in Supabase"
        />
        <Metric
          n={s.orders || 0}
          t="Ready to pull"
          d="Open, non-refunded orders"
        />
        <Metric n={s.issues || 0} t="Needs review" d="Reconciliation issues" />
      </div>
      <div className="grid">
        <section className="panel">
          <Title
            k="REAL DATA STATUS"
            t={
              s.lastSync
                ? "Latest import completed"
                : "No eBay data imported yet"
            }
          />
          <Connection
            name="eBay"
            detail={
              s.ebayConfigured
                ? "OAuth refresh token stored securely"
                : "Use Connect eBay to authorize"
            }
            ok={s.ebayConfigured}
          />
          <Connection
            name="Supabase"
            detail={s.ready ? "Schema connected" : "Not ready"}
            ok={s.ready}
          />
        </section>
        <section className="panel links">
          <Title k="CONTROLLED EBAY ACCESS" t="Normal import is read-only" />
          <p className="bodycopy">
            Import only reads eBay. Duplicate Center and CSV Intake change a
            live listing only after you review the result and confirm the
            action.
          </p>
          {!s.ebayConfigured && (
            <a className="primary" href="/api/ebay/connect">
              Connect eBay
            </a>
          )}
        </section>
      </div>
      <section className="panel">
        <Title k="FULFILLMENT" t="Recent orders" on={() => go("orders")} />
        {(s.orderRows || []).length ? (
          (s.orderRows || []).map((o: any) => <Mini key={o.id} order={o} />)
        ) : (
          <Empty text="No real open orders have been imported." />
        )}
      </section>
    </>
  );
}
function Connection({
  name,
  detail,
  ok,
}: {
  name: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="connection">
      <span>{name[0]}</span>
      <div>
        <b>{name}</b>
        <small>{detail}</small>
      </div>
      <em>{ok ? "● Connected" : "○ Offline"}</em>
    </div>
  );
}
function Title({ k, t, on }: { k: string; t: string; on?: () => void }) {
  return (
    <div className="title">
      <div>
        <small>{k}</small>
        <h3>{t}</h3>
      </div>
      {on && <button onClick={on}>Review all</button>}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
function Mini({ order }: { order: any }) {
  return (
    <div className="mini">
      <PackageCheck />
      <div>
        <b>
          {order.order_title ||
            order.marketplace_listings?.title ||
            "eBay order"}
        </b>
        <small>
          Order #{order.marketplace_order_id}
          {order.pull_location ? ` · Pull ${order.pull_location}` : ""}
        </small>
      </div>
      <div>
        <small>QUANTITY</small>
        <b>{order.quantity}</b>
      </div>
    </div>
  );
}
function Inventory({
  rows,
  q,
  setQ,
  page,
  setPage,
  total,
  loading,
}: {
  rows: Listing[];
  q: string;
  setQ: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  total: number;
  loading: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <div className="stack">
      <Intro
        title="Inventory"
        text="Only 50 records are downloaded at a time to keep Supabase usage low."
        action={
          <span className="count">{total.toLocaleString()} listings</span>
        }
      />
      <div className="toolbar">
        <label>
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, eBay SKU, or listing ID…"
          />
        </label>
      </div>
      <div className="tablebox">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Game</th>
              <th>eBay listing</th>
              <th>eBay SKU</th>
              <th>eBay qty</th>
              <th>Physical locations</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.title}</b>
                  <small>{x.set_name || "Set not imported"}</small>
                </td>
                <td>{x.game}</td>
                <td className="mono">{x.ebay_listing_id}</td>
                <td className="mono">{x.ebay_sku || "—"}</td>
                <td>
                  <strong>{x.ebay_quantity}</strong>
                </td>
                <td>
                  <div className="skus">
                    {x.physical_skus?.length ? (
                      x.physical_skus.map((s: any) => (
                        <span key={s.sku}>{s.location_label || s.sku}</span>
                      ))
                    ) : (
                      <span>Not assigned</span>
                    )}
                  </div>
                </td>
                <td>
                  {x.price == null ? "—" : `$${Number(x.price).toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <Empty text="Loading inventory…" />
        ) : (
          !rows.length && <Empty text="No listings match this search." />
        )}
      </div>
      <div className="pager">
        <button
          className="secondary"
          disabled={loading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page.toLocaleString()} of {pages.toLocaleString()}
        </span>
        <button
          className="secondary"
          disabled={loading || page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
function Orders({ rows, loading }: { rows: any[]; loading: boolean }) {
  return (
    <div className="stack">
      <Intro
        title="Orders to fulfill"
        text="The sold physical SKU has already been removed from active Supabase inventory; its location is preserved here for pulling."
        action={<span className="count">Up to 50 order lines</span>}
      />
      {loading ? (
        <Empty text="Loading orders…" />
      ) : (
        <>
          <div className="ordergrid">
            {rows.map((o) => {
              const l = o.marketplace_listings;
              return (
                <article className="order" key={o.id}>
                  <div className="ordertop">
                    <span>eBay</span>
                    <small>{new Date(o.ordered_at).toLocaleString()}</small>
                  </div>
                  <h3>{o.order_title || l?.title || "eBay order"}</h3>
                  <p>
                    Order #{o.marketplace_order_id} · Quantity {o.quantity}
                  </p>
                  <div className="location">
                    <small>PULL LOCATION / SOLD SKU</small>
                    <b>
                      <MapPin />
                      {o.pull_location ||
                        o.pull_sku ||
                        l?.ebay_sku ||
                        "No physical location"}
                    </b>
                  </div>
                </article>
              );
            })}
          </div>
          {!rows.length && (
            <Empty text="No real open orders have been imported." />
          )}
        </>
      )}
    </div>
  );
}
function Duplicates({
  groups,
  loading,
  reload,
  setMessage,
}: {
  groups: any[];
  loading: boolean;
  reload: () => Promise<void>;
  setMessage: (v: string) => void;
}) {
  const combine = async (group: any, survivorEbayId: string) => {
    if (
      !confirm(
        `Combine ${group.listings.length} live eBay listings into the newest listing? Its quantity will increase, all older listings will end, and every location SKU will be kept in Supabase.`,
      )
    )
      return;
    try {
      const r = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchKey: group.matchKey,
          survivorEbayId,
          listingEbayIds: group.listings.map((x: any) => x.ebay_listing_id),
        }),
      });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Combine failed");
      setMessage(
        `Combined duplicate group. Ended ${b.ended} listing(s); survivor quantity is ${b.quantity}.`,
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Combine failed");
    }
  };
  return (
    <div className="stack">
      <Intro
        title="Duplicate Center"
        text="Scans every active eBay listing. Same-name cards in different conditions are treated as unique; only the same card in the same condition is flagged."
        action={<span className="count">{groups.length} groups</span>}
      />
      {loading ? (
        <Empty text="Scanning active eBay listings…" />
      ) : (
        groups.map((g: any) => (
          <section className="panel duplicate" key={g.matchKey}>
            <Title
              k="DUPLICATE EBAY LISTINGS"
              t={g.listings[0]?.title || "Duplicate card"}
            />
            {g.listings.map((x: any, i: number) => (
              <div className="duprow" key={x.ebay_listing_id}>
                <div>
                  <b>{x.title}</b>
                  <small>
                    {x.set_name || "Set missing"} · #{x.card_number || "—"} ·{" "}
                    {x.finish || "Standard"} ·{" "}
                    <strong>{x.condition_name || x.detected_condition || "Condition missing"}</strong>
                  </small>
                  <small>
                    {i === 0 ? "NEWEST · " : "OLDER · "}eBay #{x.ebay_listing_id} · SKU {x.ebay_sku || "—"} · Qty{" "}
                    {x.ebay_quantity} · ${Number(x.price || 0).toFixed(2)}
                    {x.started_at ? ` · Listed ${new Date(x.started_at).toLocaleDateString()}` : ""}
                  </small>
                </div>
                {i === 0 && <button className="primary" onClick={() => combine(g, x.ebay_listing_id)}>Combine into newest</button>}
              </div>
            ))}
          </section>
        ))
      )}
      {!loading && !groups.length && (
        <Empty text="No exact duplicate active eBay listings were found." />
      )}
    </div>
  );
}
function CsvIntake({
  data,
  setData,
  setMessage,
}: {
  data: any;
  setData: (v: any) => void;
  setMessage: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const preview = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/csv-intake/preview", {
        method: "POST",
        body: form,
      });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Preview failed");
      setData(b);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!data?.newCsv) return;
    const url = URL.createObjectURL(
      new Blob([data.newCsv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = data.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  const apply = async () => {
    if (!data || data.conflicts.length) return;
    if (
      !confirm(
        `Update ${data.matchedCopies} existing-card quantities and store ${data.matchedCopies + data.newCopies} physical SKUs? This changes live eBay quantities for matched cards.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/csv-intake/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matches: data.matches,
          pending: data.pending,
          conflictCount: data.conflicts.length,
        }),
      });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Apply failed");
      setMessage(
        `CSV applied: ${b.skusStored} SKUs added to existing listings and ${b.pendingStored} SKUs saved for new listings.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <Intro
        title="CSV Intake"
        text="Upload the Card Uploader file here before sending it to eBay. The generated file preserves the same columns and contains one row for each genuinely new unique listing."
      />
      <label className="upload">
        <FileUp />
        <b>{busy ? "Checking CSV…" : "Choose Card Uploader CSV"}</b>
        <small>Exact 67-column eBay layout supported</small>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => preview(e.target.files?.[0])}
        />
      </label>
      {data && (
        <>
          <div className="metrics intake-metrics">
            <Metric
              n={data.totalRows}
              t="CSV card rows"
              d="Physical cards scanned"
            />
            <Metric
              n={data.matchedCopies}
              t="Existing matches"
              d="Increase eBay quantity"
            />
            <Metric
              n={data.newListings}
              t="New listings"
              d="Rows in output CSV"
            />
            <Metric
              n={data.conflicts.length + data.invalid.length}
              t="Blocked"
              d="Review required"
            />
          </div>
          {data.conflicts.length > 0 && (
            <div className="warning">
              <AlertTriangle />
              <div>
                <b>Resolve duplicates first</b>
                <p>
                  {data.conflicts.length} incoming card group(s) match more than
                  one live eBay listing. Open Duplicate Center, combine them,
                  then preview the CSV again.
                </p>
              </div>
            </div>
          )}
          {data.invalid.length > 0 && (
            <div className="warning">
              <AlertTriangle />
              <div>
                <b>Invalid CSV rows</b>
                <p>
                  {data.invalid.length} row(s) are missing a card identity field
                  or CustomLabel and were excluded.
                </p>
              </div>
            </div>
          )}
          <div className="intake-actions">
            <button
              className="primary"
              disabled={busy || data.conflicts.length > 0}
              onClick={apply}
            >
              <Check />
              Apply matched quantities &amp; SKUs
            </button>
            <button
              className="secondary"
              disabled={!data.newCsv}
              onClick={download}
            >
              <Download />
              Download {data.newListings} new listings
            </button>
          </div>
          <section className="panel">
            <Title k="PREVIEW" t="What will happen" />
            <p className="bodycopy">
              {data.matchedCopies} physical cards match one existing eBay
              listing and will increase that listing quantity. {data.newCopies}{" "}
              physical SKUs belong to {data.newListings} new unique listings and
              will wait in Supabase until the generated CSV is uploaded to eBay
              and the next eBay import completes.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
function Sync({
  s,
  busy,
  sync,
}: {
  s: Status;
  busy: boolean;
  sync: () => void;
}) {
  return (
    <div className="stack">
      <Intro
        title="Safe eBay import"
        text="Reads eBay and updates only the Supabase working catalog."
        action={
          <button
            className="primary"
            disabled={busy || !s.ready || !s.ebayConfigured}
            onClick={sync}
          >
            <RefreshCw className={busy ? "spin" : ""} />
            {busy ? "Importing…" : "Import from eBay"}
          </button>
        }
      />
      <div className="flow">
        {[
          ["1", "Read eBay", "No eBay changes"],
          ["2", "Update Supabase", "Listings and orders"],
          ["3", "Show results", "Real records only"],
        ].map((x) => (
          <div key={x[0]}>
            <span>{x[0]}</span>
            <b>{x[1]}</b>
            <small>{x[2]}</small>
          </div>
        ))}
      </div>
      <div className="warning">
        <AlertTriangle />
        <div>
          <b>Import safety</b>
          <p>
            If eBay returns zero listings or an authorization error, the
            database is not changed. Only separately confirmed actions in
            Duplicate Center and CSV Intake can change live eBay listings.
          </p>
        </div>
      </div>
    </div>
  );
}
function Connections({ s }: { s: Status }) {
  return (
    <div className="stack">
      <Intro
        title="Connections"
        text="App credentials stay in Render; the eBay refresh token is saved securely in Supabase."
        action={
          !s.ebayConfigured ? (
            <a className="primary" href="/api/ebay/connect">
              Connect eBay
            </a>
          ) : undefined
        }
      />
      <div className="setupgrid two">
        <Setup
          title="eBay"
          ok={s.ebayConfigured}
          text="OAuth authorization with an automatically renewed access token"
        />
        <Setup
          title="Supabase"
          ok={s.supabaseConfigured && s.ready}
          text="SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
        />
      </div>
      <div className="warning">
        <AlertTriangle />
        <div>
          <b>eBay developer settings</b>
          <p>
            Render needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RU_NAME.
            You do not need to copy a short-lived access token.
          </p>
        </div>
      </div>
    </div>
  );
}
function Setup({
  title,
  ok,
  text,
}: {
  title: string;
  ok: boolean;
  text: string;
}) {
  return (
    <article className="setup">
      <Store />
      <h3>{title}</h3>
      <p>{text}</p>
      <span className={ok ? "healthy" : "count"}>
        {ok ? "Connected" : "Not configured"}
      </span>
    </article>
  );
}
