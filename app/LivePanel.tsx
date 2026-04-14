"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Status {
  configured: boolean;
  paper?: boolean;
  baseUrl?: string;
  error?: string;
}

interface Account {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  equity: string;
  portfolio_value: string;
  options_approved_level?: number | string;
  options_trading_level?: number | string;
  pattern_day_trader: boolean;
}

interface Position {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  avg_entry_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  asset_class?: string;
}

interface Contract {
  id: string;
  symbol: string;
  name: string;
  expiration_date: string;
  strike_price: string;
  type: string;
}

interface Clock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

function money(n: string | number | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export default function LivePanel({
  defaultUnderlying,
  defaultOffsetPct,
}: {
  defaultUnderlying: string;
  defaultOffsetPct: number;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [underlying, setUnderlying] = useState(defaultUnderlying);
  const [offsetPct, setOffsetPct] = useState(defaultOffsetPct);
  const [minDte, setMinDte] = useState(21);
  const [maxDte, setMaxDte] = useState(45);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [confirmText, setConfirmText] = useState("");
  const [orderResult, setOrderResult] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/broker/status");
      const j = (await r.json()) as Status;
      setStatus(j);
    } catch (e) {
      setStatus({ configured: false, error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const refreshAll = useCallback(async () => {
    if (!status?.configured) return;
    setLoading(true);
    setError(null);
    try {
      const [a, p, c] = await Promise.all([
        fetch("/api/broker/account").then((r) => r.json()),
        fetch("/api/broker/positions").then((r) => r.json()),
        fetch("/api/broker/clock").then((r) => r.json()),
      ]);
      if (!a.ok) throw new Error(a.error);
      if (!p.ok) throw new Error(p.error);
      if (!c.ok) throw new Error(c.error);
      setAccount(a.account);
      setPositions(p.positions);
      setClock(c.clock);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status?.configured]);

  useEffect(() => {
    if (status?.configured) void refreshAll();
  }, [status?.configured, refreshAll]);

  const fetchContracts = useCallback(async () => {
    setError(null);
    setContracts([]);
    setSpot(null);
    setSelectedSymbol("");
    const q = new URLSearchParams({
      underlying,
      offsetPct: String(offsetPct),
      minDte: String(minDte),
      maxDte: String(maxDte),
    });
    try {
      const r = await fetch(`/api/broker/contracts?${q}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setContracts(j.contracts ?? []);
      setSpot(j.spot ?? null);
      if (j.contracts?.[0]) setSelectedSymbol(j.contracts[0].symbol);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [underlying, offsetPct, minDte, maxDte]);

  const placeOrder = useCallback(
    async (side: "buy" | "sell") => {
      if (!selectedSymbol) {
        setError("Pick a contract first.");
        return;
      }
      if (confirmText !== "I UNDERSTAND") {
        setError(
          "Type I UNDERSTAND in the confirmation box to place this order.",
        );
        return;
      }
      setOrderResult(null);
      setError(null);
      try {
        const r = await fetch("/api/broker/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: selectedSymbol,
            qty,
            side,
            type: "market",
            time_in_force: "day",
            confirm: "I UNDERSTAND",
          }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setOrderResult(
          `${side.toUpperCase()} submitted on ${j.paper ? "PAPER" : "LIVE"}: ` +
            (typeof j.order === "object"
              ? JSON.stringify(j.order, null, 2)
              : String(j.order)),
        );
        void refreshAll();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [selectedSymbol, confirmText, qty, refreshAll],
  );

  const endpointTag = useMemo(() => {
    if (!status?.configured) return null;
    return status.paper ? "PAPER" : "LIVE";
  }, [status]);

  if (status == null) {
    return <div className="card">Loading broker status…</div>;
  }

  if (!status.configured) {
    return (
      <div className="card">
        <h2>Broker not connected</h2>
        <p style={{ color: "var(--muted)" }}>
          Set <code>ALPACA_KEY_ID</code> and <code>ALPACA_SECRET_KEY</code> as
          environment variables (Vercel → project settings → Environment
          Variables, or a local <code>.env.local</code>), then redeploy or
          restart the dev server. Keys default to the paper endpoint; flip to
          live only by setting <code>ALPACA_BASE_URL</code> and{" "}
          <code>ALPACA_ALLOW_LIVE=true</code>.
        </p>
        <p style={{ color: "var(--muted)" }}>
          Get free paper keys at{" "}
          <a
            href="https://alpaca.markets/"
            target="_blank"
            rel="noopener noreferrer"
          >
            alpaca.markets
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button onClick={refreshAll} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <span
          className={`tag ${endpointTag === "LIVE" ? "EXPIRE" : "SELL"}`}
          style={{ alignSelf: "center" }}
        >
          {endpointTag}
        </span>
        {clock && (
          <span style={{ alignSelf: "center", color: "var(--muted)" }}>
            Market {clock.is_open ? "OPEN" : "CLOSED"} · next change{" "}
            {new Date(
              clock.is_open ? clock.next_close : clock.next_open,
            ).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div
          className="disclaimer"
          style={{
            borderColor: "rgba(255, 107, 107, 0.4)",
            background: "rgba(255, 107, 107, 0.08)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {account && (
        <div className="stat-row">
          <div className="stat">
            <div className="label">Cash</div>
            <div className="value">{money(account.cash)}</div>
          </div>
          <div className="stat">
            <div className="label">Equity</div>
            <div className="value">{money(account.equity)}</div>
          </div>
          <div className="stat">
            <div className="label">Buying power</div>
            <div className="value">{money(account.buying_power)}</div>
          </div>
          <div className="stat">
            <div className="label">Options level</div>
            <div className="value">
              {String(
                account.options_approved_level ??
                  account.options_trading_level ??
                  "—",
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Positions</h2>
        {positions && positions.length > 0 ? (
          <div className="scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Avg entry</th>
                  <th>Mkt value</th>
                  <th>Unrealized P/L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td>
                    <td>{p.side}</td>
                    <td>{p.qty}</td>
                    <td>{money(p.avg_entry_price)}</td>
                    <td>{money(p.market_value)}</td>
                    <td
                      style={{
                        color:
                          Number(p.unrealized_pl) >= 0
                            ? "var(--accent-2)"
                            : "var(--danger)",
                      }}
                    >
                      {money(p.unrealized_pl)} (
                      {(Number(p.unrealized_plpc) * 100).toFixed(2)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>No open positions.</p>
        )}
      </div>

      <div className="card">
        <h2>Find a call contract</h2>
        <div className="field-grid">
          <div>
            <label>Underlying</label>
            <input
              value={underlying}
              onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label>Strike offset</label>
            <input
              type="number"
              step={0.005}
              value={offsetPct}
              onChange={(e) => setOffsetPct(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Min DTE</label>
            <input
              type="number"
              value={minDte}
              onChange={(e) => setMinDte(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Max DTE</label>
            <input
              type="number"
              value={maxDte}
              onChange={(e) => setMaxDte(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="btn-row">
          <button onClick={fetchContracts}>Search contracts</button>
          {spot != null && (
            <span style={{ alignSelf: "center", color: "var(--muted)" }}>
              Spot ≈ {money(spot)}
            </span>
          )}
        </div>

        {contracts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label>Contract</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            >
              {contracts.map((c) => (
                <option key={c.id} value={c.symbol}>
                  {c.symbol} — strike ${c.strike_price} — exp{" "}
                  {c.expiration_date}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Place order {endpointTag === "LIVE" ? "⚠ LIVE" : "(paper)"}</h2>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Sends a market order for the selected contract through your Alpaca
          account. The server requires the literal phrase{" "}
          <b>I UNDERSTAND</b> in the request body.
        </p>
        <div className="field-grid">
          <div>
            <label>Symbol (OCC)</label>
            <input
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label>Quantity</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <div className="full">
            <label>Type I UNDERSTAND to enable order buttons</label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="I UNDERSTAND"
            />
          </div>
        </div>
        <div className="btn-row">
          <button
            onClick={() => placeOrder("buy")}
            disabled={confirmText !== "I UNDERSTAND" || !selectedSymbol}
          >
            Buy to open
          </button>
          <button
            className="secondary"
            onClick={() => placeOrder("sell")}
            disabled={confirmText !== "I UNDERSTAND" || !selectedSymbol}
          >
            Sell to close
          </button>
        </div>
        {orderResult && (
          <pre
            style={{
              marginTop: 12,
              background: "var(--panel-2)",
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              overflow: "auto",
            }}
          >
            {orderResult}
          </pre>
        )}
      </div>
    </>
  );
}
