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
  Printer,
  Waves,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
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
  | "sync-control"
  | "aging"
  | "exceptions"
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
  ["sync-control", "Sync Control", RefreshCw],
  ["aging", "Aging Report", PackageCheck],
  ["exceptions", "Exception Center", ShieldAlert],
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
    [duplicateScanned, setDuplicateScanned] = useState(false),
    [duplicateLoading, setDuplicateLoading] = useState(false),
    [intake, setIntake] = useState<any>(null),
    [manaPool, setManaPool] = useState<any>(null),
    [syncControl, setSyncControl] = useState<any>(null),
    [aging, setAging] = useState<any>(null),
    [exceptions, setExceptions] = useState<any>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState<ConfirmOptions | null>(null);
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const orderImportRunning = useRef(false);
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
    setDuplicateLoading(true);
    try {
      const b: any = await fetch("/api/duplicates", { cache: "no-store" }).then(
        (r) => r.json(),
      );
      if (b.error) throw new Error(b.error);
      setDuplicateGroups(b.groups || []);
      setDuplicateScanned(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Duplicate scan failed");
    } finally {
      setDuplicateLoading(false);
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
    if (view !== "manapool" || !status.ready) return;
    setLoading(true);
    fetch("/api/manapool", { cache: "no-store" }).then(r => r.json()).then(setManaPool).catch(e => setMessage(e.message)).finally(() => setLoading(false));
  }, [view, status.ready]);
  const loadExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/exceptions", { cache: "no-store" });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body.error || "Exception Center failed");
      setExceptions(body);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Exception Center failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (view === "exceptions" && status.ready) loadExceptions();
  }, [view, status.ready, loadExceptions]);
  const loadSyncControl = useCallback(async () => {
    try {
      const response = await fetch("/api/sync-control", { cache: "no-store" });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body.error || "Sync Control failed");
      setSyncControl(body);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync Control failed");
    }
  }, []);
  useEffect(() => {
    if (view !== "sync-control" || !status.ready) return;
    loadSyncControl();
    const timer = window.setInterval(loadSyncControl, 15000);
    return () => window.clearInterval(timer);
  }, [view, status.ready, loadSyncControl]);
  const loadAging = useCallback(async (bucket="180",game="all",reviewed="open",currentPage=1) => {
    setLoading(true);
    try {
      const response=await fetch(`/api/aging?bucket=${bucket}&game=${game}&reviewed=${reviewed}&page=${currentPage}`,{cache:"no-store"});
      const body:any=await response.json();
      if(!response.ok)throw new Error(body.error||"Aging Report failed");
      setAging(body);
    } catch(e){setMessage(e instanceof Error?e.message:"Aging Report failed");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{if(view==="aging"&&status.ready&&!aging)loadAging();},[view,status.ready,aging,loadAging]);
  useEffect(() => {
    if (!status.ready || !status.ebayConfigured) return;
    let stopped = false;
    const importOpenOrders = async () => {
      if (document.visibilityState !== "visible" || orderImportRunning.current) return;
      orderImportRunning.current = true;
      try {
        const response = await fetch("/api/orders/import", { method: "POST", cache: "no-store" });
        const result: any = await response.json();
        if (!response.ok || result?.ok === false) throw new Error(result?.error || "eBay order import failed");
        if (!stopped) await load();
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : "eBay order import failed");
      } finally {
        orderImportRunning.current = false;
      }
    };
    // One recovery pass when the app opens. Live changes arrive through the
    // hosted webhook; the browser does not poll eBay on a timer.
    importOpenOrders();
    return () => { stopped = true; };
  }, [status.ready, status.ebayConfigured, load]);
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
              {id === "exceptions" && Boolean(exceptions?.counts?.total || status.issues) && (
                <i>{exceptions?.counts?.total || status.issues}</i>
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
              loading={duplicateLoading}
              scanned={duplicateScanned}
              scan={loadDuplicates}
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
          {view === "sync-control" && <SyncControl data={syncControl} reload={loadSyncControl} notify={setMessage} go={setView} confirmAction={confirmAction} />}{" "}
          {view === "aging" && <AgingReport data={aging} setData={setAging} loading={loading} load={loadAging} notify={setMessage} />}{" "}
          {view === "exceptions" && <ExceptionCenter data={exceptions} loading={loading} reload={loadExceptions} notify={setMessage} go={setView} confirmAction={confirmAction} />}{" "}
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
  const groupedOrders = [...rows.reduce((groups: Map<string, any>, row: any) => {
    const marketplace = row.marketplace === "manapool" ? "manapool" : "ebay";
    const key = `${marketplace}:${row.marketplace_order_id}`;
    const group = groups.get(key) || { key, marketplace, marketplace_order_id: row.marketplace_order_id, ordered_at: row.ordered_at, lines: [] };
    group.lines.push(row);
    groups.set(key, group);
    return groups;
  }, new Map()).values()].sort((a: any, b: any) => String(b.ordered_at).localeCompare(String(a.ordered_at)));
  const ebayOrders = groupedOrders.filter((order: any) => order.marketplace !== "manapool");
  const manaPoolOrders = groupedOrders.filter((order: any) => order.marketplace === "manapool");
  const displayedOrders = orderCategory === "ebay" ? ebayOrders : manaPoolOrders;
  const confirmShipped = async (order: any) => {
    const quantity = order.lines.reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0);
    if (!(await confirmAction({
      title: "Confirm shipment?",
      message: `Order #${order.marketplace_order_id} contains ${quantity} card${quantity === 1 ? "" : "s"} across ${order.lines.length} line${order.lines.length === 1 ? "" : "s"}. The entire order and all allocated SKUs will be completed together.`,
      confirmLabel: "Confirm shipped",
      tone: "danger",
    }))) return;
    setShipping(order.key);
    try {
      const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketplace: order.marketplace, marketplaceOrderId: order.marketplace_order_id }) });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body.error || "Shipment confirmation failed");
      notify(`Order #${order.marketplace_order_id} marked shipped. ${body.lines || order.lines.length} order line(s) completed together.`);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Shipment confirmation failed");
    } finally {
      setShipping(null);
    }
  };
  const printManaPoolLabel = async (order: any) => {
    const printWindow = window.open(`/api/orders/print?type=label&orderId=${encodeURIComponent(order.marketplace_order_id)}`, "_blank");
    if (!printWindow) {
      notify("The shipping label could not open. Allow pop-ups for this site and try again.");
      return;
    }
    printWindow.opener = null;
    setShipping(order.key);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketplace: "manapool", marketplaceOrderId: order.marketplace_order_id }),
      });
      const body: any = await response.json();
      if (!response.ok) throw new Error(body.error || "Mana Pool shipment confirmation failed");
      notify(`Shipping label opened and order #${order.marketplace_order_id} was marked shipped in Mana Pool.`);
      await reload();
    } catch (error) {
      notify(`${error instanceof Error ? error.message : "Mana Pool shipment confirmation failed"}. The order was kept in your list.`);
    } finally {
      setShipping(null);
    }
  };
  return (
    <div className="stack">
      <Intro
        title="Orders to fulfill"
        text="Each marketplace order is grouped together. Confirm shipped once to complete every card and remove all allocated SKUs in that order."
        action={<span className="count">{groupedOrders.length} open orders</span>}
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
            {displayedOrders.map((o: any) => {
              const first = o.lines[0];
              const manaPoolPayload = first?.raw_payload?.mana_pool_order;
              const manaPoolOrder = manaPoolPayload?.order ?? manaPoolPayload?.data?.order ?? manaPoolPayload?.data ?? manaPoolPayload;
              const centsTotal = [
                manaPoolOrder?.total_cents,
                manaPoolOrder?.order_total_cents,
                manaPoolOrder?.total_amount_cents,
                manaPoolOrder?.total?.cents,
                manaPoolOrder?.total?.amount_cents,
                manaPoolPayload?.total_cents,
                first?.raw_payload?.total_cents,
              ].find((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
              const dollarTotal = [
                manaPoolOrder?.total_price,
                manaPoolOrder?.order_total,
                manaPoolOrder?.total_amount,
                typeof manaPoolOrder?.total === "number" || typeof manaPoolOrder?.total === "string" ? manaPoolOrder.total : undefined,
              ].find((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
              const ebayTotal = first?.raw_payload?.orderTotal;
              const totalText = o.marketplace === "manapool"
                ? centsTotal !== undefined
                  ? `$${(Number(centsTotal) / 100).toFixed(2)}`
                  : dollarTotal !== undefined ? `$${Number(dollarTotal).toFixed(2)}` : "—"
                : ebayTotal == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: first?.raw_payload?.currency || "USD" }).format(Number(ebayTotal));
              const quantity = o.lines.reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0);
              return (
                <article className="order order-group" key={o.key}>
                  <div className="order-group-head">
                    <div className="ordertop">
                      <span>{o.marketplace === "manapool" ? "Mana Pool" : "eBay"}</span>
                      <small>{new Date(o.ordered_at).toLocaleString()}</small>
                    </div>
                    <div className="order-summary"><h3>Order #{o.marketplace_order_id}</h3><p>{o.lines.length} item{o.lines.length === 1 ? "" : "s"} · {quantity} card{quantity === 1 ? "" : "s"}</p></div>
                    <div className="order-stat"><small>ORDER TOTAL</small><b>{totalText}</b></div>
                    {o.marketplace === "manapool" && <div className="order-print-actions">
                      <button className="primary" onClick={()=>window.open(`/api/orders/print?type=packing&orderId=${encodeURIComponent(o.marketplace_order_id)}`,"_blank","noopener,noreferrer")}><Printer/>Packing slip</button>
                      <button className="primary" disabled={shipping === o.key} onClick={()=>printManaPoolLabel(o)}><Printer/>{shipping === o.key ? "Confirming…" : "4×6 label"}</button>
                    </div>}
                    {o.marketplace !== "manapool" && <button className="primary wide" disabled={shipping === o.key} onClick={() => confirmShipped(o)}>
                      <PackageCheck /> {shipping === o.key ? "Confirming…" : "Confirm entire order shipped"}
                    </button>}
                  </div>
                  <div className="order-lines">{o.lines.map((line: any) => {
                    const l = line.marketplace_listings;
                    const legacyItemId = line.raw_payload?.legacyItemId;
                    const image = legacyItemId ? `/api/ebay/image?itemId=${encodeURIComponent(String(legacyItemId))}` : (l?.image_url || line.raw_payload?.image_url);
                    return <div className="order-line" key={line.id}>
                      <div className="order-card-info"><div className="card-title-hover"><h3>{line.order_title || l?.title || "Card"}</h3>{image && <div className="card-image-popover"><img src={image} alt={line.order_title || l?.title || "Card"} /></div>}</div></div>
                      <div className="order-stat"><small>QUANTITY</small><b>{line.quantity}</b></div>
                      <div className="location"><small>PULL LOCATION / SOLD SKU</small><b><MapPin />{line.pull_location || line.pull_sku || l?.ebay_sku || "No physical location"}</b></div>
                    </div>;
                  })}</div>
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
    try { const r=await fetch("/api/webhooks/setup",{method:"POST"});const b:any=await r.json();if(!r.ok)throw new Error(b.error||"Webhook setup failed");setWebhooks(b);notify("eBay and Mana Pool independently confirmed their live webhook connections."); }
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
  const reviewConflict = async (listing:any) => {
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"review-conflict",id:listing.id})});
      const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Could not reopen this mapping");
      setPanelData(b.overview); setPreview(null); notify(`${listing.title} is ready for mapping review.`);
    } catch(e){notify(e instanceof Error?e.message:"Could not reopen this mapping");} finally{setWorking(false);}
  };
  const combineConflict = async (conflict:any) => {
    if(!(await confirmAction({title:"Combine these eBay listings?",message:`These ${conflict.listings.length} listings share the same reviewed Mana Pool printing, condition, language, and finish. The newest eBay listing will remain, quantities will be added, and every physical SKU will be moved to it in Supabase.`,confirmLabel:"Combine listings",tone:"danger"}))) return;
    setWorking(true);
    try {
      const r=await fetch("/api/manapool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"combine-conflict",listing_ids:conflict.listings.map((x:any)=>x.id)})});
      const b:any=await r.json(); if(!r.ok) throw new Error(b.error||"Could not combine these listings");
      setPanelData(b.overview); setPreview(null); notify(`Combined the listings at quantity ${b.quantity}; all Supabase locations were preserved.`);
    } catch(e){notify(e instanceof Error?e.message:"Could not combine these listings");} finally{setWorking(false);}
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
      {!!panelData?.conflicts?.length && <section className="panel">
        <Title k="REVIEW REQUIRED" t={`${panelData.conflicts.length} Mana Pool mapping conflict${panelData.conflicts.length===1?"":"s"}`} />
        <div className="warning"><AlertTriangle/><div><b>Live inventory sync is blocked for these variants</b><p>Each group points to the same Scryfall printing, condition, language, and finish. Review the titles and Supabase pull locations before combining anything.</p></div></div>
        <div className="mapping-review">
          {panelData.conflicts.map((conflict:any)=><article className="mapping-card" key={conflict.key}>
            <div><b>{conflict.listings[0]?.title}</b><small>Scryfall {conflict.scryfall_id} · {conflict.language_id} · {conflict.condition_id} · {conflict.finish_id}</small></div>
            {conflict.listings.map((listing:any)=><div className="duprow" key={listing.id}>
              <div><b>{listing.title}</b><small>eBay #{listing.ebay_listing_id} · Primary SKU {listing.ebay_sku||"—"} · Qty {listing.ebay_quantity}</small><small>Supabase locations: {listing.locations?.length?listing.locations.map((x:any)=>`${x.sku}${x.status!=="available"?` (${x.status})`:""}`).join(", "):"No location stored"}</small></div>
              <button className="secondary" disabled={working} onClick={()=>reviewConflict(listing)}>Review mapping</button>
            </div>)}
            <div className="modal-actions"><button className="primary" disabled={working} onClick={()=>combineConflict(conflict)}>Combine as same card</button></div>
          </article>)}
        </div>
      </section>}
      <section className="panel">
        <Title k="SAFE SYNC" t="Review before live changes" />
        <p className="bodycopy">Each card printing and finish uses the current lowest Mana Pool listing: $0.40 when the lowest price is $0.40 or less; otherwise the lowest price plus 30%. Only reviewed Scryfall mappings are sent.</p>
        <div className="modal-actions">
          <button className="secondary" disabled={working||!panelData?.configured} onClick={()=>run("preview")}>Preview changes</button>
          <button className="secondary" disabled={working||!panelData?.configured} onClick={orders}>Import Mana Pool orders</button>
          <button className="primary" disabled={working||!panelData?.configured||!panelData?.enabled||!!panelData?.conflicts?.length} onClick={()=>run("sync")}>Sync live inventory</button>
        </div>
        {preview && <>
          <div className={(preview.missing||preview.conflicts?.length)?"warning":"mapping-summary"}><Check/><div><b>{preview.total} of {preview.mapped} mapped listings have a market price</b><p>{preview.conflicts?.length?`${preview.conflicts.length} mapping conflict${preview.conflicts.length===1?"":"s"} must be reviewed before syncing.`:preview.missing?`${preview.missing} cards were blocked because Mana Pool has no matching printing and finish price.`:preview.enabled?"Live sync is enabled.":"Live sync is still disabled in Render."}</p></div></div>
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
        <div className="mapping-summary"><div>
          <span><strong className={webhooks?.ebay?.live?"healthy":"count"}>{webhooks?.ebay?.live?"LIVE":"NOT VERIFIED"}</strong> eBay sales and listings</span>
          <span><strong className={webhooks?.manaPoolLive?"healthy":"count"}>{webhooks?.manaPoolLive?"LIVE":"NOT VERIFIED"}</strong> Mana Pool orders</span>
        </div><small>Each marketplace is verified separately. The overall status is live only when both services confirm their subscription.</small></div>
        <div className="modal-actions">
          <span className={webhooks?.configured?"healthy":"count"}>{webhooks?.configured?"Both connections verified":"Setup or repair required"}</span>
          <button className="primary" disabled={working||!panelData?.configured||webhooks?.configured} onClick={enableWebhooks}>{webhooks?.configured?"Live webhooks verified":"Enable / repair live webhooks"}</button>
        </div>
        {webhooks?.baseUrl&&<p className="bodycopy">Receiving events at {webhooks.baseUrl}</p>}
        {webhooks?.lastEbayWebhookAt&&<p className="bodycopy">Last eBay event: {webhooks.lastEbayWebhookEvent||"unknown"} · {new Date(webhooks.lastEbayWebhookAt).toLocaleString()} · {webhooks.lastEbayWebhookResult||"received"}</p>}
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
  scanned,
  scan,
  setMessage,
  confirmAction,
}: {
  groups: any[];
  loading: boolean;
  scanned: boolean;
  scan: () => Promise<void>;
  setMessage: (v: string) => void;
  confirmAction: ConfirmAction;
}) {
  const [gameTab, setGameTab] = useState<"pokemon" | "magic">("pokemon");
  const [combiningKey, setCombiningKey] = useState<string | null>(null);
  const [combinedKeys, setCombinedKeys] = useState<Set<string>>(() => new Set());
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(() => new Set());
  const pokemonGroups = groups.filter((group: any) => group.listings?.some((listing: any) => listing.game === "pokemon"));
  const magicGroups = groups.filter((group: any) => group.listings?.some((listing: any) => listing.game === "magic"));
  const displayedGroups = (gameTab === "pokemon" ? pokemonGroups : magicGroups)
    .filter((group: any) => !ignoredKeys.has(group.matchKey));
  const remainingGroups = displayedGroups.filter((group: any) => !combinedKeys.has(group.matchKey)).length;
  const manualScan = async () => {
    setCombinedKeys(new Set());
    await scan();
  };
  const combine = async (group: any, survivorEbayId: string) => {
    if (!(await confirmAction({
      title: "Combine duplicate listings?",
      message: `${group.listings.length} live eBay listings will be combined into the newest listing. Its quantity will increase, older listings will end, and every location SKU will remain in Supabase.`,
      confirmLabel: "Combine into newest",
      tone: "danger",
    }))) return;
    setCombiningKey(group.matchKey);
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
      setCombinedKeys((current) => new Set(current).add(group.matchKey));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Combine failed");
    } finally {
      setCombiningKey(null);
    }
  };
  const ignorePokemonGroup = async (group: any) => {
    if (!(await confirmAction({
      title: "Mark as not a duplicate?",
      message: "This Pokémon group will be removed from Duplicate Center and will stay hidden on future scans. No eBay listing, quantity, or SKU will be changed.",
      confirmLabel: "Not a duplicate",
    }))) return;
    setCombiningKey(group.matchKey);
    try {
      const r = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ignore",
          game: "pokemon",
          matchKey: group.matchKey,
          listingEbayIds: group.listings.map((x: any) => x.ebay_listing_id),
        }),
      });
      const b: any = await r.json();
      if (!r.ok) throw new Error(b.error || "Could not dismiss this group");
      setIgnoredKeys((current) => new Set(current).add(group.matchKey));
      setMessage("Marked as not a duplicate. No eBay listings or SKUs were changed.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not dismiss this group");
    } finally {
      setCombiningKey(null);
    }
  };
  return (
    <div className="stack">
      <Intro
        title="Duplicate Center"
        text="Scan eBay only when you are ready, then review and combine duplicate groups one at a time. Combining does not start another scan."
        action={<div className="duplicate-scan-actions">{scanned && <span className="count">{remainingGroups} remaining</span>}<button className="primary" disabled={loading || combiningKey !== null} onClick={manualScan}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Scanning…" : scanned ? "Scan again" : "Scan active eBay listings"}</button></div>}
      />
      <div className="order-categories" role="tablist" aria-label="Duplicate card game">
        <button className={gameTab === "pokemon" ? "active" : ""} onClick={() => setGameTab("pokemon")}><span>Pokémon</span><b>{pokemonGroups.length}</b></button>
        <button className={gameTab === "magic" ? "active" : ""} onClick={() => setGameTab("magic")}><span>Magic</span><b>{magicGroups.length}</b></button>
      </div>
      {loading ? (
        <Empty text="Scanning active eBay listings…" />
      ) : (
        displayedGroups.map((g: any) => {
          const isCombining = combiningKey === g.matchKey;
          const isCombined = combinedKeys.has(g.matchKey);
          return <section className={`panel duplicate${isCombined ? " duplicate-combined" : ""}`} key={g.matchKey}>
            <div className="duplicate-heading">
              <Title
                k="DUPLICATE EBAY LISTINGS"
                t={g.listings[0]?.title || "Duplicate card"}
              />
              {gameTab === "pokemon" && !isCombined && (
                <button className="secondary" disabled={combiningKey !== null} onClick={() => ignorePokemonGroup(g)}>
                  Not a duplicate
                </button>
              )}
            </div>
            {isCombining && <div className="combine-status working"><RefreshCw className="spin" /><div><b>Combining listings with eBay…</b><small>Keep this page open until this group finishes.</small></div><i /></div>}
            {isCombined && <div className="combine-status complete"><Check /><div><b>Combined successfully</b><small>The older listings ended and their SKUs were moved to the surviving listing.</small></div></div>}
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
                {i === 0 && (isCombined
                  ? <span className="combined-badge"><Check /> Combined</span>
                  : <button className="primary" disabled={combiningKey !== null} onClick={() => combine(g, x.ebay_listing_id)}>{isCombining ? <><RefreshCw className="spin" /> Combining…</> : "Combine into newest"}</button>)}
              </div>
            ))}
          </section>;
        })
      )}
      {!loading && !scanned && (
        <Empty text="No scan has been run. Click Scan active eBay listings when you are ready." />
      )}
      {!loading && scanned && !displayedGroups.length && (
        <Empty text={`No exact duplicate active ${gameTab === "pokemon" ? "Pokémon" : "Magic"} listings were found.`} />
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
      message: `You reviewed ${data.existingMatchGroups?.length||0} existing eBay match group(s) and ${data.newGroups?.filter((x:any)=>x.isDuplicate).length||0} duplicate group(s) inside the CSV. All ${data.matchedCopies + data.newCopies} physical SKUs will be retained in Supabase.`,
      confirmLabel: "Confirm and apply",
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
              Confirm matches &amp; apply SKUs
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
              {data.matchedCopies} physical card{data.matchedCopies===1?"":"s"} match existing eBay listings. The other {data.newCopies} physical cards become {data.newListings} unique new listings because {data.newDuplicateCopies} are additional copies found inside this CSV. Every CSV SKU is retained in Supabase.
            </p>
          </section>
          {!!data.existingMatchGroups?.length && <section className="panel">
            <Title k="CONFIRM EXISTING MATCHES" t={`${data.existingMatchGroups.length} existing eBay listing${data.existingMatchGroups.length===1?"":"s"}`} />
            <p className="bodycopy">These cards will not be included in the download file. Their existing eBay quantities will increase and each incoming location SKU will attach to the matching Supabase listing.</p>
            <div className="mapping-review">{data.existingMatchGroups.map((group:any)=><article className="mapping-card" key={group.listingId}>
              <div><b>{group.existingTitle}</b><small>eBay #{group.ebayListingId} · Current quantity {group.existingQuantity} → New quantity {group.resultQuantity}</small></div>
              <div className="mapping-options"><span><b>Existing locations</b><small>{group.existingLocations?.length?group.existingLocations.map((x:any)=>x.sku).join(", "):group.existingSku||"No stored location"}</small></span><span><b>Incoming CSV SKUs</b><small>{group.incomingSkus.join(", ")}</small></span></div>
            </article>)}</div>
          </section>}
          {!!data.newGroups?.length && <section className="panel">
            <Title k="NEW LISTING GROUPS" t={`${data.newCopies} cards → ${data.newListings} eBay listings`} />
            <p className="bodycopy">Duplicate cards within the CSV are combined into one output listing with the total quantity shown below. All individual SKUs remain saved for their pull locations.</p>
            {!!data.newDuplicateCopies&&<div className="mapping-summary"><b>{data.newDuplicateCopies} additional duplicate copies combined</b><small>This is the difference between the physical-card count and the number of new listing rows.</small></div>}
            <div className="mapping-review">{data.newGroups.map((group:any)=><details className="mapping-card" key={group.matchKey} open={group.isDuplicate}>
              <summary><b>{group.title}</b><small>{group.isDuplicate?`${group.rowCount} CSV rows combined into quantity ${group.quantity}`:"One new listing"}</small></summary>
              <div className="mapping-options"><span><b>Supabase pull SKUs</b><small>{group.skus.join(", ")}</small></span></div>
            </details>)}</div>
          </section>}
        </>
      )}
    </div>
  );
}
function AgingReport({data,setData,loading,load,notify}:{data:any;setData:(v:any)=>void;loading:boolean;load:(bucket?:string,game?:string,reviewed?:string,page?:number)=>Promise<void>;notify:(v:string)=>void}){
  const [working,setWorking]=useState<string|null>(null);
  const bucket=data?.bucket||"180",game=data?.game||"all",reviewed=data?.reviewed||"open",page=data?.page||1;
  const refresh=(changes:any={})=>load(changes.bucket||bucket,changes.game||game,changes.reviewed||reviewed,changes.page||1);
  const action=async(actionName:string,listingId?:string)=>{
    setWorking(listingId||actionName);
    try{
      const response=await fetch("/api/aging",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:actionName,listingId})});
      const body:any=await response.json();if(!response.ok)throw new Error(body.error||"Aging action failed");
      notify(body.message||"Aging Report updated.");await refresh({page});
    }catch(e){notify(e instanceof Error?e.message:"Aging action failed");}
    finally{setWorking(null);}
  };
  const counts=data?.counts||{};
  return <div className="stack">
    <Intro title="Aging Report" text="Review older eBay listings using age and the latest 30 days of buyer traffic. No listing is changed automatically." action={<button className="primary" disabled={working!==null} onClick={()=>action("refresh-traffic")}><RefreshCw className={working==="refresh-traffic"?"spin":""}/>{working==="refresh-traffic"?"Updating…":"Update traffic"}</button>}/>
    <div className="metrics aging-metrics">
      <Metric n={counts.age90||0} t="90–179 days" d="Beginning to age"/><Metric n={counts.age180||0} t="180–364 days" d="Review recommended"/><Metric n={counts.age365||0} t="365+ days" d="Priority review"/><Metric n={data?.total||0} t="Current queue" d="Matches selected filters"/>
    </div>
    <section className="panel">
      <div className="toolbar aging-toolbar">
        <select value={bucket} onChange={event=>refresh({bucket:event.target.value})}><option value="90">90–179 days</option><option value="180">180–364 days</option><option value="365">365+ days</option></select>
        <select value={game} onChange={event=>refresh({game:event.target.value})}><option value="all">All games</option><option value="pokemon">Pokémon</option><option value="magic">Magic</option></select>
        <select value={reviewed} onChange={event=>refresh({reviewed:event.target.value})}><option value="open">Needs review</option><option value="reviewed">Reviewed</option><option value="all">All listings</option></select>
        <button className="secondary" disabled={loading} onClick={()=>refresh({page})}><RefreshCw className={loading?"spin":""}/>Refresh</button>
      </div>
      {loading&&!data?<Empty text="Loading aged listings…"/>:data?.rows?.length?<div className="aging-list">{data.rows.map((row:any)=><article key={row.id}>
        <div className="aging-title"><span>{row.game}</span><b>{row.title}</b><small>eBay #{row.ebay_listing_id} · {row.ebay_sku||"No SKU"}</small></div>
        <div className="aging-stat"><small>AGE</small><b>{row.ageDays?.toLocaleString()||"—"} days</b></div>
        <div className="aging-stat"><small>PRICE / QTY</small><b>${Number(row.price||0).toFixed(2)} · {row.ebay_quantity}</b></div>
        <div className="aging-stat"><small>30-DAY TRAFFIC</small><b>{row.traffic_impressions==null?"Not collected":`${Number(row.traffic_impressions).toLocaleString()} imp · ${Number(row.traffic_views||0).toLocaleString()} views`}</b><em>{row.traffic_transactions!=null?`${row.traffic_transactions} sale${Number(row.traffic_transactions)===1?"":"s"}`:""}</em></div>
        <div className={`aging-recommendation ${row.recommendation?.key||"collect"}`}><small>RECOMMENDATION</small><b>{row.recommendation?.label||"Review listing"}</b></div>
        <div className="aging-actions"><a className="secondary" href={`https://www.ebay.com/itm/${row.ebay_listing_id}`} target="_blank" rel="noreferrer">Open eBay</a><button className="primary" disabled={working!==null} onClick={()=>action(row.aging_reviewed_at?"unreview":"review",row.id)}>{working===row.id?"Saving…":row.aging_reviewed_at?"Return to queue":"Mark reviewed"}</button></div>
      </article>)}</div>:<Empty text="No active listings match these aging filters."/>}
      {!!data?.total&&<div className="pager"><button className="secondary" disabled={page<=1||loading} onClick={()=>refresh({page:page-1})}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button className="secondary" disabled={page*data.pageSize>=data.total||loading} onClick={()=>refresh({page:page+1})}>Next</button></div>}
    </section>
    <section className="notice aging-safety"><b>Safe review mode</b><span>The report recommends changes but does not end, relist, promote, or reprice anything. Traffic refresh processes up to 200 older listings per run.</span></section>
    <section className="panel aging-setup"><Title k="FIRST-TIME SETUP" t="Enable listing dates and traffic"/><p className="bodycopy">Run <b>supabase/v1.11.5-aging-report.sql</b> in Supabase, reconnect eBay once to approve read-only Analytics access, then use Refresh from eBay before updating traffic.</p><div className="toolbar"><a className="secondary" href="/api/ebay/connect">Reconnect eBay for Analytics</a></div></section>
  </div>;
}

function SyncControl({ data, reload, notify, go, confirmAction }: { data:any; reload:()=>Promise<void>; notify:(v:string)=>void; go:(v:View)=>void; confirmAction:ConfirmAction }) {
  const [working,setWorking]=useState<string|null>(null);
  const act=async(action:string,eventId?:string)=>{
    if(action==="full-import"&&!(await confirmAction({title:"Refresh all eBay data?",message:"This reads the current eBay catalog and open orders, updates Supabase, and runs the normal reconciliation workflow.",confirmLabel:"Refresh from eBay"})))return;
    if(action==="retry-all"&&!(await confirmAction({title:"Retry all failed events?",message:"The app will safely rerun up to 50 failed marketplace events. Existing orders are recognized so inventory is not deducted twice.",confirmLabel:"Retry failed events"})))return;
    setWorking(eventId||action);
    try{
      const response=await fetch("/api/sync-control",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,eventId})});
      const body:any=await response.json();
      if(!response.ok&&response.status!==207)throw new Error(body.error||"Sync action failed");
      notify(body.message||"Sync action completed.");
      await reload();
    }catch(e){notify(e instanceof Error?e.message:"Sync action failed");}
    finally{setWorking(null);}
  };
  const summary=data?.summary||{};
  const connections=data?.connections||{};
  const stamp=(value:any)=>value?new Date(value).toLocaleString():"No event received yet";
  const events=(data?.events||[]).slice(0,50);
  return <div className="stack">
    <Intro title="Sync Control Center" text="Monitor live marketplace events, recover failed jobs, and verify that eBay, Mana Pool, and Supabase agree." action={<button className="secondary" disabled={working!==null} onClick={reload}><RefreshCw/>Refresh status</button>}/>
    <div className="metrics sync-metrics">
      <Metric n={summary.pending||0} t="Processing" d="Events still running"/>
      <Metric n={summary.failed||0} t="Failed events" d="Automatic or manual retry"/>
      <Metric n={summary.mismatches||0} t="Quantity mismatches" d="Requires review"/>
      <Metric n={events.filter((event:any)=>event.status==="processed").length} t="Recent successes" d="Latest 100 events"/>
    </div>
    <section className="panel">
      <Title k="LIVE CONNECTIONS" t="Webhook activity received by this hosted service"/>
      <div className="sync-connections">
        {[{key:"ebay",name:"eBay",value:connections.ebay},{key:"manapool",name:"Mana Pool",value:connections.manapool}].map((connection:any)=><article key={connection.key} className={connection.value?.healthy?"connection-ok":"connection-wait"}>
          <div><span className="sync-dot"/><strong>{connection.name}</strong><em>{connection.value?.healthy?"Connected":connection.value?.connected?"Needs attention":"Not configured"}</em></div>
          <b>{connection.value?.lastAt?`Last event: ${stamp(connection.value.lastAt)}`:connection.value?.connected?"Connected · waiting for the next marketplace event":"Webhook setup required"}</b>
          <small>{connection.value?.event||"No event received since Sync Control was installed"} · {connection.value?.result||"Connection remains ready"}</small>
        </article>)}
      </div>
      {connections.endpoint&&<p className="sync-endpoint">Hosted receiver: {connections.endpoint}</p>}
    </section>
    <section className="panel">
      <div className="title"><div><small>RECOVERY TOOLS</small><h3>Verify and repair synchronization</h3></div><div className="toolbar sync-actions">
        <button className="secondary" disabled={working!==null} onClick={()=>act("reconcile")}><RefreshCw className={working==="reconcile"?"spin":""}/>Reconcile quantities</button>
        <button className="secondary" disabled={working!==null||!summary.failed} onClick={()=>act("retry-all")}><RefreshCw className={working==="retry-all"?"spin":""}/>Retry all failed</button>
        <button className="primary" disabled={working!==null} onClick={()=>act("full-import")}><RefreshCw className={working==="full-import"?"spin":""}/>Refresh from eBay</button>
      </div></div>
      <p className="bodycopy">Reconciliation checks stored quantities without changing a marketplace. Failed-event retries use the same duplicate-safe order import. Inventory uncertainty remains in the Exception Center for your review.</p>
      {!!summary.mismatches&&<button className="secondary" onClick={()=>go("exceptions")}>Review {summary.mismatches} mismatch{summary.mismatches===1?"":"es"}</button>}
    </section>
    <section className="panel">
      <Title k="EVENT TIMELINE" t="Latest webhook and recovery activity"/>
      {events.length?<div className="sync-timeline">{events.map((event:any)=><article key={event.id}>
        <span className={`event-state ${event.status}`}>{event.status}</span>
        <div><b>{String(event.source||"sync").replaceAll("-"," ")} · {event.event_type}</b><small>{new Date(event.received_at).toLocaleString()} · Attempt {event.attempts||0}</small>{event.error_message&&<p>{event.error_message}</p>}</div>
        {event.status==="failed"&&<button className="secondary" disabled={working!==null} onClick={()=>act("retry-one",event.id)}>{working===event.id?<><RefreshCw className="spin"/>Retrying…</>:"Retry now"}</button>}
      </article>)}</div>:<Empty text="No live webhook events have been recorded yet. New events will appear here automatically."/>}
    </section>
  </div>;
}

function ExceptionCenter({ data, loading, reload, notify, go, confirmAction }: { data:any; loading:boolean; reload:()=>Promise<void>; notify:(v:string)=>void; go:(v:View)=>void; confirmAction:ConfirmAction }) {
  const [retrying,setRetrying]=useState<string|null>(null);
  const [ended,setEnded]=useState<any>(null);
  const scanEnded=async()=>{
    setRetrying("scan-ended");
    try{const response=await fetch("/api/reconciliation/ended",{cache:"no-store"});const body:any=await response.json();if(!response.ok)throw new Error(body.error||"Ended listing scan failed");setEnded(body);}
    catch(e){notify(e instanceof Error?e.message:"Ended listing scan failed");}
    finally{setRetrying(null);}
  };
  const recoverEnded=async(row:any)=>{
    setRetrying(`recover-${row.endedEbayId}`);
    try{const response=await fetch("/api/reconciliation/ended",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)});const body:any=await response.json();if(!response.ok)throw new Error(body.error||"SKU recovery failed");notify(`Recovered ${body.sku} and attached it to ${body.title}.`);setEnded((current:any)=>({...current,rows:current.rows.filter((x:any)=>x.endedEbayId!==row.endedEbayId),count:Math.max(0,current.count-1)}));await reload();}
    catch(e){notify(e instanceof Error?e.message:"SKU recovery failed");}
    finally{setRetrying(null);}
  };
  const recoverAllEnded=async()=>{
    const count=ended?.rows?.length||0;
    if(!count||!(await confirmAction({title:"Add all safe missing SKUs?",message:`This will link ${count} reviewed SKU${count===1?"":"s"} to their exact active eBay listings in Supabase. Every match is rechecked before it is added.`,confirmLabel:"Add safe matches"})))return;
    setRetrying("recover-all");
    try{
      const response=await fetch("/api/reconciliation/ended",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"apply-all"})});
      const body:any=await response.json();if(!response.ok)throw new Error(body.error||"SKU recovery failed");
      notify(`Added ${body.addedCount} missing SKU${body.addedCount===1?"":"s"} to Supabase${body.skippedCount?`; ${body.skippedCount} skipped after rechecking`:""}.`);
      await scanEnded(); await reload();
    }catch(e){notify(e instanceof Error?e.message:"SKU recovery failed");}
    finally{setRetrying(null);}
  };
  const retry=async(action:string,item?:any)=>{
    if(action==="magic-mapping"){go("manapool");return;}
    let sku="";
    if(action==="add-missing-sku"){
      sku=window.prompt("Enter the missing physical SKU location","")?.trim()||"";
      if(!sku)return;
    }
    setRetrying(action);
    try{
      const response=await fetch("/api/exceptions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,issueId:item?.issueId,sku})});
      const body:any=await response.json();
      if(!response.ok)throw new Error(body.error||"Retry failed");
      notify("Retry completed. Exception Center has been refreshed.");
      await reload();
    }catch(e){notify(e instanceof Error?e.message:"Retry failed");}
    finally{setRetrying(null);}
  };
  const manageInventoryException=async(action:"end-listing"|"match-quantity"|"dismiss-exception",item:any)=>{
    const options=action==="end-listing"
      ?{title:"End this eBay listing?",message:`This will end eBay listing #${item.ebayListingId}. Its Supabase SKU records will be retained, but the listing will become inactive.`,confirmLabel:"End listing",tone:"danger" as const}
      :action==="match-quantity"
        ?{title:"Change the eBay quantity?",message:`This will change eBay quantity from ${item.ebayQuantity} to ${item.activeSkuCount}, matching the available SKU locations stored in Supabase.`,confirmLabel:`Set quantity to ${item.activeSkuCount}`}
        :{title:"Remove this exception?",message:"This only dismisses the exception. It will not change eBay quantity or any Supabase SKU. The same mismatch will remain hidden on future scans.",confirmLabel:"Remove exception",tone:"danger" as const};
    if(!(await confirmAction(options)))return;
    setRetrying(`${action}-${item.issueId}`);
    try{
      const response=await fetch("/api/exceptions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,issueId:item.issueId})});
      const body:any=await response.json();if(!response.ok)throw new Error(body.error||"Action failed");
      notify(body.message||"Exception updated.");await reload();
    }catch(e){notify(e instanceof Error?e.message:"Action failed");}
    finally{setRetrying(null);}
  };
  const health=data?.health||{};
  const stamp=(value:any)=>value?new Date(value).toLocaleString():"No event recorded";
  return (
    <div className="stack">
      <Intro
        title="Exception Center"
        text="Review synchronization and inventory problems in one place. Nothing is changed until you choose a retry action."
        action={<button className="primary" disabled={loading||retrying!==null} onClick={reload}><RefreshCw className={loading?"spin":""}/>{loading?"Checking…":"Refresh status"}</button>}
      />
      <div className="metrics exception-metrics">
        <Metric n={data?.counts?.total||0} t="Needs attention" d="All open exceptions"/>
        <Metric n={data?.counts?.errors||0} t="Sync failures" d="Retry recommended"/>
        <Metric n={data?.counts?.inventory||0} t="Quantity mismatches" d="eBay versus locations"/>
        <Metric n={data?.counts?.unmapped||0} t="Magic unmapped" d="Not sent to Mana Pool"/>
      </div>
      <section className="panel">
        <Title k="LIVE CONNECTION ACTIVITY" t="Latest successful or attempted events"/>
        <div className="health-grid">
          <div><small>LAST EBAY IMPORT</small><b>{stamp(health.lastEbayImport)}</b></div>
          <div><small>LAST EBAY WEBHOOK</small><b>{stamp(health.lastEbayWebhookAt)}</b><em>{health.lastEbayWebhookResult||"No result recorded"}</em></div>
          <div><small>LAST MANA POOL WEBHOOK</small><b>{stamp(health.lastManaPoolWebhookAt)}</b><em>{health.lastManaPoolWebhookResult||"No result recorded"}</em></div>
        </div>
      </section>
      <section className="panel">
        <div className="title"><div><small>ENDED LISTING RECONCILIATION</small><h3>Recover missing location SKUs</h3></div><div className="toolbar"><button className="secondary" disabled={retrying!==null} onClick={scanEnded}><RefreshCw className={retrying==="scan-ended"?"spin":""}/>{retrying==="scan-ended"?"Scanning…":ended?"Scan again":"Scan ended listings"}</button>{!!ended?.rows?.length&&<button className="primary" disabled={retrying!==null} onClick={recoverAllEnded}>{retrying==="recover-all"?<><RefreshCw className="spin"/>Adding…</>:"Add all safe matches"}</button>}</div></div>
        <p className="bodycopy">Uses your September 28 ended-listing file and verifies every SKU against live eBay and Supabase data. Only an unsold SKU with one exact active-listing match is shown. Sold, existing, mismatched, and ambiguous SKUs are excluded.</p>
        {ended&&(ended.rows?.length?<div className="exception-list">{ended.rows.map((row:any)=><article className="exception-row" key={`${row.endedEbayId}-${row.sku}`}>
          <PackageCheck/><div><span>Missing SKU</span><b>{row.sku}</b><p>{row.endedTitle}</p><small>Ended eBay #{row.endedEbayId} → Active eBay #{row.survivorEbayId} · {row.survivorTitle}</small></div>
          <button className="primary" disabled={retrying!==null} onClick={()=>recoverEnded(row)}>{retrying===`recover-${row.endedEbayId}`?<><RefreshCw className="spin"/>Adding…</>:"Confirm and add"}</button>
        </article>)}</div>:<Empty text="No safe missing SKUs were found in recently ended listings."/>)}
      </section>
      <section className="panel">
        <Title k="OPEN EXCEPTIONS" t={`${data?.items?.length||0} item${data?.items?.length===1?"":"s"} requiring review`}/>
        {loading&&!data?<Empty text="Checking synchronization and inventory status…"/>:data?.items?.length?
          <div className="exception-list">{data.items.map((item:any)=><article className={`exception-row ${item.severity}`} key={item.id}>
            <AlertTriangle/><div><span>{item.category}</span><b>{item.title}</b><p>{item.detail}</p>{item.occurredAt&&<small>{new Date(item.occurredAt).toLocaleString()}</small>}</div>
            {item.category==="Inventory"?<div className="exception-actions">
              {item.action&&<button className="secondary" disabled={retrying!==null} onClick={()=>retry(item.action,item)}>{retrying===item.action?<><RefreshCw className="spin"/>Working…</>:item.actionLabel}</button>}
              <button className="secondary" disabled={retrying!==null||item.activeSkuCount<1} onClick={()=>manageInventoryException("match-quantity",item)}>Set eBay qty to {item.activeSkuCount}</button>
              <button className="secondary" disabled={retrying!==null} onClick={()=>manageInventoryException("end-listing",item)}>End listing</button>
              <button className="secondary" disabled={retrying!==null} onClick={()=>manageInventoryException("dismiss-exception",item)}>Remove exception</button>
            </div>:item.action&&<button className="secondary" disabled={retrying!==null} onClick={()=>retry(item.action,item)}>{retrying===item.action?<><RefreshCw className="spin"/>Working…</>:item.actionLabel}</button>}
          </article>)}</div>:<Empty text="Everything looks healthy. No open exceptions were found."/>}
      </section>
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
