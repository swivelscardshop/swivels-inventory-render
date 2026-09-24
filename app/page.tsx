"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Waves,
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
  | "manapool"
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
  manaPoolConfigured?: boolean;
  manaPoolSyncEnabled?: boolean;
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
type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
};
type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;
const nav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["inventory", "Inventory", Boxes],
  ["orders", "Orders", ShoppingBag],
  ["duplicates", "Duplicate Center", Copy],
  ["intake", "CSV Intake", FileUp],
  ["manapool", "Mana Pool", Waves],
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
    [manaPool, setManaPool] = useState<any>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState<ConfirmOptions | null>(null);
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const confirmAction: ConfirmAction = useCallback((options) => {
    return new Promise((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation(options);
    });
  }, []);
  const closeConfirmation = useCallback((confirmed: boolean) => {
    confirmationResolver.current?.(confirmed);
    confirmationResolver.current = null;
    setConfirmation(null);
  }, []);
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
  useEffect(() => {
    if (view !== "manapool" || !status.ready) return;
    setLoading(true);
    fetch("/api/manapool", { cache: "no-store" }).then(r => r.json()).then(setManaPool).catch(e => setMessage(e.message)).finally(() => setLoading(false));
  }, [view, status.ready]);
  useEffect(() => {
    // Marketplace webhooks update the hosted database even when no browser is
    // open. While the app is open, refresh the visible data automatically so
    // the user never has to click Import eBay just to see webhook changes.
    const refreshVisible = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await load();
        if (view === "orders") await loadOrders();
        if (view === "inventory") await loadInventory(q,page);
        if (view === "duplicates") await loadDuplicates();
        if (view === "manapool") {
          const r=await fetch("/api/manapool",{cache:"no-store"});
          if(r.ok)setManaPool(await r.json());
        }
      } catch { /* retain the last good screen during a temporary refresh failure */ }
    };
    const timer=window.setInterval(refreshVisible,10000);
    return ()=>window.clearInterval(timer);
  },[load,loadOrders,loadInventory,loadDuplicates,view,q,page]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const sync = async () => {
    if (!(await confirmAction({
      title: "Import current eBay data?",
      message: "This imports active listings and open orders into Supabase. The import itself does not change any eBay listing.",
      confirmLabel: "Import from eBay",
    }))) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Sync failed");
      setMessage(
        b.warning ||
          `Imported ${b.listings.toLocaleString()} active listings, detected ${(b.magicSingles || 0).toLocaleString()} Magic singles, automatically mapped ${b.automaticallyMapped||0}, published ${b.manaPoolPublished||0} Mana Pool quantity updates, and imported ${b.orders.toLocaleString()} order lines.`,
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
          <img src="/swivels-card-shop-logo.jpg" alt="Swivels Card Shop" />
          <div className="brand-name">
            <b>Swivels</b>
            <small>Card Shop</small>
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
            <b>Swivels Card Shop</b>
            <small>Inventory Manager</small>
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
            <small className="header-brand">SWIVELS CARD SHOP</small>
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
          {message && <div className="toast" role="status"><Check /><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X /></button></div>}
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
          {view === "orders" && <Orders rows={orders} loading={loading} reload={loadOrders} notify={setMessage} confirmAction={confirmAction} />}{" "}
          {view === "duplicates" && (
            <Duplicates
              groups={duplicateGroups}
              loading={loading}
              reload={loadDuplicates}
              setMessage={setMessage}
              confirmAction={confirmAction}
            />
          )}{" "}
          {view === "intake" && (
            <CsvIntake
              data={intake}
              setData={setIntake}
              setMessage={setMessage}
              confirmAction={confirmAction}
            />
          )}{" "}
          {view === "manapool" && <ManaPoolPanel data={manaPool} loading={loading} notify={setMessage} confirmAction={confirmAction} />}{" "}
          {view === "sync" && <Sync s={status} busy={busy} sync={sync} />}{" "}
          {view === "settings" && <Connections s={status} />}
        </div>
      </main>
      {confirmation && <ConfirmDialog options={confirmation} onDecision={closeConfirmation} />}
    </div>
  );
}
function ConfirmDialog({ options, onDecision }: { options: ConfirmOptions; onDecision: (confirmed: boolean) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDecision(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDecision]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => onDecision(false)}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={() => onDecision(false)}><X /></button>
        <div className={`modal-icon ${options.tone === "danger" ? "danger" : ""}`}>
          {options.tone === "danger" ? <AlertTriangle /> : <Check />}
        </div>
        <h2 id="confirm-title">{options.title}</h2>
        <p>{options.message}</p>
        <div className="modal-actions">
          <button className="secondary" onClick={() => onDecision(false)}>Cancel</button>
          <button className={options.tone === "danger" ? "danger-button" : "primary"} onClick={() => onDecision(true)}>{options.confirmLabel}</button>
        </div>
      </section>
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
function Orders({ rows, loading, reload, notify, confirmAction }: { rows: any[]; loading: boolean; reload: () => Promise<void>; notify: (message: string) => void; confirmAction: ConfirmAction }) {
  const [shipping, setShipping] = useState<string | null>(null);
  const [orderCategory, setOrderCategory] = useState<"ebay" | "manapool">("ebay");
  const ebayOrders = rows.filter((row) => row.marketplace !== "manapool");
  const manaPoolOrders = rows.filter((row) => row.marketplace === "manapool");
  const displayedOrders = orderCategory === "ebay" ? ebayOrders : manaPoolOrders;
  const confirmShipped = async (order: any) => {
    if (!(await confirmAction({
      title: "Confirm shipment?",
      message: `Order #${order.marketplace_order_id} will be completed and its allocated SKU will be permanently removed from Supabase. Only continue after the card has shipped.`,
      confirmLabel: "Confirm shipped",
      tone: "danger",
    }))) return;
    setShipping(order.id);
    try {
      const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order.id }) });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body.error || "Shipment confirmation failed");
      notify(`Order #${order.marketplace_order_id} marked shipped. Allocated SKU removed from Supabase.`);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Shipment confirmation failed");
    } finally {
      setShipping(null);
    }
  };
  return (
    <div className="stack">
      <Intro
        title="Orders to fulfill"
        text="The displayed SKU is reserved in Supabase for this order. It is removed only after you click Confirm shipped."
        action={<span className="count">Up to 50 order lines</span>}
      />
      <div className="order-categories" role="tablist" aria-label="Order marketplace">
        <button className={orderCategory === "ebay" ? "active" : ""} onClick={() => setOrderCategory("ebay")}><span>eBay orders</span><b>{ebayOrders.length}</b></button>
        <button className={orderCategory === "manapool" ? "active" : ""} onClick={() => setOrderCategory("manapool")}><span>Mana Pool orders</span><b>{manaPoolOrders.length}</b></button>
      </div>
      {loading ? (
        <Empty text="Loading orders…" />
      ) : (
        <>
          <div className="ordergrid">
            {displayedOrders.map((o) => {
              const l = o.marketplace_listings;
              const legacyItemId = o.raw_payload?.legacyItemId;
              const image = legacyItemId ? `/api/ebay/image?itemId=${encodeURIComponent(String(legacyItemId))}` : (l?.image_url || o.raw_payload?.image_url);
              const total = o.marketplace === "manapool"
                ? (o.raw_payload?.mana_pool_order?.total_cents ?? o.raw_payload?.total_cents)
                : o.raw_payload?.orderTotal;
              const totalText = total == null ? "—" : o.marketplace === "manapool"
                ? `$${(Number(total) / 100).toFixed(2)}`
                : new Intl.NumberFormat("en-US", { style: "currency", currency: o.raw_payload?.currency || "USD" }).format(Number(total));
              return (
                <article className="order" key={o.id}>
                  <div className="ordertop">
                    <span>{o.marketplace === "manapool" ? "Mana Pool" : "eBay"}</span>
                    <small>{new Date(o.ordered_at).toLocaleString()}</small>
                  </div>
                  <div className="order-card-info">
                    <div className="card-title-hover">
                      <h3>{o.order_title || l?.title || "eBay order"}</h3>
                      {image && <div className="card-image-popover"><img src={image} alt={o.order_title || l?.title || "Card"} /></div>}
                    </div>
                    <p>Order #{o.marketplace_order_id}</p>
                  </div>
                  <div className="order-stat"><small>QUANTITY</small><b>{o.quantity}</b></div>
                  <div className="order-stat"><small>ORDER TOTAL</small><b>{totalText}</b></div>
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
                  <button className="primary wide" disabled={shipping === o.id} onClick={() => confirmShipped(o)}>
                    <PackageCheck /> {shipping === o.id ? "Confirming…" : "Confirm shipped"}
                  </button>
                </article>
              );
            })}
          </div>
          {!displayedOrders.length && (
            <Empty text={orderCategory === "ebay" ? "No open eBay orders have been imported." : "No open Mana Pool orders have been imported."} />
          )}
        </>
      )}
    </div>
  );
}
function ManaPoolPanel({ data, loading, notify, confirmAction }: { data:any; loading:boolean; notify:(message:string)=>void; confirmAction:ConfirmAction }) {
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [panelData, setPanelData] = useState<any>(data);
  const [mapResult, setMapResult] = useState<any>(null);
  const [webhooks, setWebhooks] = useState<any>(null);
  useEffect(()=>setPanelData(data),[data]);
  useEffect(()=>{ fetch("/api/webhooks/setup",{cache:"no-store"}).then(async r=>{const b=await r.json();if(r.ok)setWebhooks(b);}).catch(()=>{}); },[]);
  const run = async (mode:"preview"|"sync") => {
    if (mode === "sync" && !(await confirmAction({ title:"Sync mapped Magic cards?", message:"This will update live Mana Pool quantities and prices for mapped Magic listings. eBay remains unchanged.", confirmLabel:"Sync Mana Pool", tone:"danger" }))) return;
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode})});
      const text=await r.text(); let b:any;
      try { b=text?JSON.parse(text):{}; }
      catch { throw new Error(`Mana Pool preview failed with HTTP ${r.status}. The server returned a webpage instead of API data; check the Render logs for this request.`); }
      if(!r.ok) throw new Error(b.error||`Mana Pool sync failed (HTTP ${r.status})`);
      if(mode==="preview") setPreview(b); else notify(`Updated ${b.updated} Mana Pool listings.`);
    } catch(e) { notify(e instanceof Error?e.message:"Mana Pool sync failed"); } finally { setWorking(false); }
  };
  const orders = async () => {
    setWorking(true); try { const r=await fetch("/api/manapool",{method:"PATCH"}); const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Order import failed"); notify(`Imported ${b.orders} Mana Pool orders and ${b.lines} order lines.`); } catch(e){notify(e instanceof Error?e.message:"Order import failed");} finally{setWorking(false);}
  };
  const enableWebhooks = async () => {
    if (!(await confirmAction({title:"Enable live marketplace webhooks?",message:"eBay and Mana Pool will send listing and sale events directly to this Render service. Sales will update the other marketplace even when your computer is off.",confirmLabel:"Enable live webhooks"}))) return;
    setWorking(true);
    try { const r=await fetch("/api/webhooks/setup",{method:"POST"});const b:any=await r.json();if(!r.ok)throw new Error(b.error||"Webhook setup failed");setWebhooks({configured:true,baseUrl:b.baseUrl});notify("Live eBay and Mana Pool webhooks are enabled."); }
    catch(e){notify(e instanceof Error?e.message:"Webhook setup failed");}finally{setWorking(false);}
  };
  const mapNext = async () => {
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"map"})});
      const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Magic mapping failed");
      setPanelData(b.overview); setMapResult(b);
      notify(`Checked ${b.processed} cards: ${b.matched} mapped, ${b.review} need review, ${b.unmatched} truly unmatched${b.failed?`, ${b.failed} lookup failures remain queued`:""}.`);
    } catch(e){notify(e instanceof Error?e.message:"Magic mapping failed");} finally{setWorking(false);}
  };
  const confirmMap = async (listing:any,candidate:any) => {
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"confirm-map",id:listing.id,scryfall_id:candidate.id})});
      const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Mapping confirmation failed");
      setPanelData(b.overview); notify(`Mapped ${listing.title} to ${candidate.name}.`);
    } catch(e){notify(e instanceof Error?e.message:"Mapping confirmation failed");} finally{setWorking(false);}
  };
  const retryUnresolved = async () => {
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"retry-unresolved"})});
      const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Could not reset unresolved cards");
      setPanelData(b.overview); setMapResult(null); notify("Unresolved cards are queued for a fresh mapping check.");
    } catch(e){notify(e instanceof Error?e.message:"Could not reset unresolved cards");} finally{setWorking(false);}
  };
  const downloadUnmatchedLog = () => {
    const rows = panelData?.unresolvedDetails || [];
    const quote = (value:any) => `"${String(value ?? "").replace(/"/g,'""')}"`;
    const csv = [
      ["eBay Listing ID","eBay Title","Status","Parsed Card Name","Parsed Collector Number","Parsed Set","Parsed Finish","Reason"].map(quote).join(","),
      ...rows.map((x:any) => [x.ebay_listing_id,x.title,x.status,x.parsed_name,x.parsed_number,x.parsed_set,x.parsed_finish,x.reason].map(quote).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href=url; link.download="manapool-unmatched-mapping-log.csv"; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="stack">
    <Intro title="Mana Pool connection" text="Sync active eBay Magic: The Gathering individual-card listings. Sealed packs, boxes, decks, and products remain excluded." action={<span className={panelData?.configured?"healthy":"count"}>{panelData?.configured?"Connected":"Token required"}</span>} />
    {loading ? <Empty text="Loading Mana Pool status…"/> : <>
      <div className="metrics">
        <Metric n={panelData?.mapped||0} t="Mapped Magic singles" d="Ready to preview" />
        <Metric n={panelData?.unmapped||0} t="Singles needing mapping" d="Mana Pool identifier missing" />
        <Metric n={panelData?.enabled?"ON":"OFF"} t="Live writes" d="Controlled by Render setting" />
      </div>
      <section className="panel">
        <Title k="SAFE SYNC" t="Review before live changes" />
        <p className="bodycopy">Each card printing and finish uses the current lowest Mana Pool listing: $0.40 when the lowest price is $0.40 or less; otherwise the lowest price plus 30%. Only reviewed Scryfall mappings are sent.</p>
        <div className="modal-actions">
          <button className="secondary" disabled={working||!panelData?.configured} onClick={()=>run("preview")}>Preview changes</button>
          <button className="secondary" disabled={working||!panelData?.configured} onClick={orders}>Import Mana Pool orders</button>
          <button className="primary" disabled={working||!panelData?.configured||!panelData?.enabled} onClick={()=>run("sync")}>Sync live inventory</button>
        </div>
        {preview && <>
          <div className={preview.missing?"warning":"mapping-summary"}><Check/><div><b>{preview.total} of {preview.mapped} mapped listings have a market price</b><p>{preview.missing?`${preview.missing} cards were blocked because Mana Pool has no matching printing and finish price.`:preview.enabled?"Live sync is enabled.":"Live sync is still disabled in Render."}</p></div></div>
          {!!preview.preview?.length && <div className="mapping-review">
            <h3>Pricing preview</h3>
            <p className="bodycopy">Showing the first {preview.preview.length} cards. Prices are in U.S. dollars.</p>
            {preview.preview.slice(0,20).map((item:any,index:number)=><div className="mapping-card" key={`${item.title}-${index}`}>
              <b>{item.title}</b><small>{item.condition_id} · {item.finish_id} · Qty {item.quantity} · Lowest ${(item.lowest_cents/100).toFixed(2)} → Your price ${(item.price_cents/100).toFixed(2)}</small>
            </div>)}
          </div>}
        </>}
      </section>
      <section className="panel">
        <Title k="LIVE CLOUD SYNC" t="Run automatically while your computer is off" />
        <p className="bodycopy">Webhooks send new eBay listings and marketplace sales directly to this Render service. eBay remains the quantity master, and Supabase prevents the same sale from being processed twice.</p>
        <div className="modal-actions">
          <span className={webhooks?.configured?"healthy":"count"}>{webhooks?.configured?"Webhooks enabled":"Setup required"}</span>
          <button className="primary" disabled={working||!panelData?.configured||webhooks?.configured} onClick={enableWebhooks}>{webhooks?.configured?"Live webhooks enabled":"Enable live webhooks"}</button>
        </div>
        {webhooks?.baseUrl&&<p className="bodycopy">Receiving events at {webhooks.baseUrl}</p>}
      </section>
      <section className="panel">
        <Title k="REQUIRED BEFORE FIRST SYNC" t="Map Magic singles"/>
        <p className="bodycopy">Match eBay Magic singles through Scryfall, which Mana Pool accepts directly. Each run checks up to 40 cards. Ambiguous matches stay here for your review; nothing is sent to Mana Pool yet.</p>
        <div className="modal-actions">
          {!!((panelData?.unmatched||0)+(panelData?.reviewCount||0)) && <button className="secondary" disabled={working} onClick={retryUnresolved}>Recheck {(panelData?.unmatched||0)+(panelData?.reviewCount||0)} unresolved cards</button>}
          <button className="primary" disabled={working||!panelData?.configured||!panelData?.queued} onClick={mapNext}>{working?"Checking cards…":panelData?.queued?`Map next ${Math.min(40,panelData.queued)} cards`:"All queued cards checked"}</button>
        </div>
        {mapResult && <div className="mapping-summary"><b>Last mapping batch</b><div><span><strong>{mapResult.processed}</strong> checked</span><span><strong>{mapResult.matched}</strong> mapped</span><span><strong>{mapResult.review}</strong> need review</span><span><strong>{mapResult.unmatched}</strong> truly unmatched</span>{!!mapResult.failed&&<span><strong>{mapResult.failed}</strong> lookup failures queued</span>}<span><strong>{panelData?.queued||0}</strong> remaining</span></div><small>This result stays here until you run another batch or leave the page.</small></div>}
        {!!panelData?.unmatched && <div className="warning"><AlertTriangle/><div><b>{panelData.unmatched} cards could not be matched automatically</b><p>They were set aside so the next batch can continue. They are not sent to Mana Pool.</p></div></div>}
        {!!panelData?.unresolvedDetails?.length && <div className="mapping-review">
          <div className="modal-actions"><h3>Unmatched mapping log</h3><button className="secondary" onClick={downloadUnmatchedLog}>Download CSV log</button></div>
          <p className="bodycopy">This shows exactly how each eBay title was interpreted. Incorrect parsed values identify which part of the title prevented the match.</p>
          {panelData.unresolvedDetails.map((item:any)=><details className="mapping-card" key={`log-${item.id}`}>
            <summary><b>{item.title}</b><small>{item.reason}</small></summary>
            <div className="mapping-options"><span><b>Parsed card</b><small>{item.parsed_name || "Missing"}</small></span><span><b>Collector number</b><small>{item.parsed_number || "Missing"}</small></span><span><b>Set</b><small>{item.parsed_set || "Missing"}</small></span><span><b>Finish</b><small>{item.parsed_finish}</small></span></div>
          </details>)}
        </div>}
        {!!panelData?.review?.length && <div className="mapping-review">
          <h3>Matches needing your review</h3>
          {panelData.review.map((listing:any)=><article className="mapping-card" key={listing.id}>
            <div><b>{listing.title}</b><small>Choose the exact printing below</small></div>
            <div className="mapping-options">{(listing.manapool_mapping_candidates||[]).map((candidate:any)=><button className="secondary" disabled={working} key={candidate.id} onClick={()=>confirmMap(listing,candidate)}>
              {candidate.image_url&&<img src={candidate.image_url} alt=""/>}<span><b>{candidate.name}</b><small>{candidate.set_name} · #{candidate.collector_number}</small></span>
            </button>)}</div>
          </article>)}
        </div>}
      </section>
    </>}
  </div>;
}
function Duplicates({
  groups,
  loading,
  reload,
  setMessage,
  confirmAction,
}: {
  groups: any[];
  loading: boolean;
  reload: () => Promise<void>;
  setMessage: (v: string) => void;
  confirmAction: ConfirmAction;
}) {
  const combine = async (group: any, survivorEbayId: string) => {
    if (!(await confirmAction({
      title: "Combine duplicate listings?",
      message: `${group.listings.length} live eBay listings will be combined into the newest listing. Its quantity will increase, older listings will end, and every location SKU will remain in Supabase.`,
      confirmLabel: "Combine into newest",
      tone: "danger",
    }))) return;
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
  confirmAction,
}: {
  data: any;
  setData: (v: any) => void;
  setMessage: (v: string) => void;
  confirmAction: ConfirmAction;
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
    if (!(await confirmAction({
      title: "Apply CSV inventory changes?",
      message: `${data.matchedCopies} existing-card quantities will be updated and ${data.matchedCopies + data.newCopies} physical SKUs will be stored. This changes live eBay quantities for matched cards.`,
      confirmLabel: "Apply changes",
      tone: "danger",
    }))) return;
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
