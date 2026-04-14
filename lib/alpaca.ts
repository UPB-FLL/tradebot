// Server-only Alpaca client. Never import this from a "use client" module.
//
// Defaults to the paper endpoint. Switching to the live endpoint requires
// BOTH the env vars to point at the live URL AND ALPACA_ALLOW_LIVE=true so
// a misconfigured deploy can't start firing real orders by accident.

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

export interface AlpacaCreds {
  keyId: string;
  secret: string;
  baseUrl: string;
  isPaper: boolean;
}

export class AlpacaConfigError extends Error {}
export class AlpacaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
  }
}

export function getCreds(): AlpacaCreds {
  const keyId = process.env.ALPACA_KEY_ID?.trim();
  const secret = process.env.ALPACA_SECRET_KEY?.trim();
  if (!keyId || !secret) {
    throw new AlpacaConfigError(
      "ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set. See .env.local.example.",
    );
  }
  const requestedBase = process.env.ALPACA_BASE_URL?.trim() || PAPER_BASE;
  const allowLive = process.env.ALPACA_ALLOW_LIVE === "true";
  const isPaper = requestedBase !== LIVE_BASE;
  if (!isPaper && !allowLive) {
    throw new AlpacaConfigError(
      "Refusing to use the live Alpaca endpoint without ALPACA_ALLOW_LIVE=true.",
    );
  }
  return { keyId, secret, baseUrl: requestedBase, isPaper };
}

export function hasCreds(): boolean {
  return Boolean(
    process.env.ALPACA_KEY_ID?.trim() && process.env.ALPACA_SECRET_KEY?.trim(),
  );
}

async function request<T>(
  creds: AlpacaCreds,
  path: string,
  init: RequestInit = {},
  base: string = creds.baseUrl,
): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": creds.keyId,
      "APCA-API-SECRET-KEY": creds.secret,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AlpacaApiError(
      res.status,
      text,
      `Alpaca ${res.status} on ${path}: ${text.slice(0, 400)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  equity: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  options_trading_level?: number | string;
  options_approved_level?: number | string;
  crypto_status?: string;
}

export interface AlpacaPosition {
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

export interface AlpacaClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface AlpacaOptionContract {
  id: string;
  symbol: string; // OCC symbol (root + YYMMDD + C/P + strike*1000 padded)
  name: string;
  status: string;
  tradable: boolean;
  expiration_date: string;
  strike_price: string;
  type: "call" | "put";
  style: "american" | "european";
  underlying_symbol: string;
  close_price?: string;
}

export interface PlaceOrderArgs {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  limit_price?: number;
  time_in_force?: "day" | "gtc";
}

export async function getAccount(): Promise<AlpacaAccount> {
  return request<AlpacaAccount>(getCreds(), "/v2/account");
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return request<AlpacaPosition[]>(getCreds(), "/v2/positions");
}

export async function getClock(): Promise<AlpacaClock> {
  return request<AlpacaClock>(getCreds(), "/v2/clock");
}

export async function listCallContracts(args: {
  underlying: string;
  minStrike?: number;
  maxStrike?: number;
  expirationOnOrAfter?: string; // YYYY-MM-DD
  expirationOnOrBefore?: string; // YYYY-MM-DD
  limit?: number;
}): Promise<AlpacaOptionContract[]> {
  const q = new URLSearchParams({
    underlying_symbols: args.underlying.toUpperCase(),
    type: "call",
    status: "active",
    limit: String(args.limit ?? 50),
  });
  if (args.minStrike != null) q.set("strike_price_gte", String(args.minStrike));
  if (args.maxStrike != null) q.set("strike_price_lte", String(args.maxStrike));
  if (args.expirationOnOrAfter)
    q.set("expiration_date_gte", args.expirationOnOrAfter);
  if (args.expirationOnOrBefore)
    q.set("expiration_date_lte", args.expirationOnOrBefore);
  const out = await request<{
    option_contracts: AlpacaOptionContract[];
    next_page_token?: string | null;
  }>(getCreds(), `/v2/options/contracts?${q.toString()}`);
  return out.option_contracts ?? [];
}

export async function getLatestTrade(
  underlying: string,
): Promise<{ price: number } | null> {
  try {
    const data = await request<{ trade?: { p?: number } }>(
      getCreds(),
      `/v2/stocks/${encodeURIComponent(underlying.toUpperCase())}/trades/latest`,
      {},
      DATA_BASE,
    );
    const p = data.trade?.p;
    return typeof p === "number" ? { price: p } : null;
  } catch {
    return null;
  }
}

export async function placeOrder(args: PlaceOrderArgs): Promise<unknown> {
  const body: Record<string, unknown> = {
    symbol: args.symbol,
    qty: args.qty,
    side: args.side,
    type: args.type ?? "market",
    time_in_force: args.time_in_force ?? "day",
  };
  if (args.type === "limit" && args.limit_price != null) {
    body.limit_price = args.limit_price.toFixed(2);
  }
  return request<unknown>(getCreds(), "/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
