import { NextRequest, NextResponse } from "next/server";
import {
  AlpacaApiError,
  AlpacaConfigError,
  getCreds,
  placeOrder,
} from "@/lib/alpaca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/broker/order
 *
 * Body: { symbol: string, qty: number, side: "buy" | "sell",
 *         type?: "market" | "limit", limit_price?: number,
 *         time_in_force?: "day" | "gtc",
 *         confirm: "I UNDERSTAND" }
 *
 * Safety checks applied here (not just on the client):
 *  - Requires the literal string "I UNDERSTAND" in the `confirm` field.
 *  - Refuses to route to the live endpoint unless ALPACA_ALLOW_LIVE=true
 *    (enforced inside getCreds()).
 *  - Refuses qty <= 0 or qty > 10 unless ALPACA_MAX_QTY overrides it.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.confirm !== "I UNDERSTAND") {
    return NextResponse.json(
      { ok: false, error: "Missing confirmation. Set `confirm` to 'I UNDERSTAND'." },
      { status: 400 },
    );
  }

  const symbol = String(body.symbol ?? "").trim();
  const qty = Number(body.qty);
  const side = body.side === "sell" ? "sell" : "buy";
  const type = body.type === "limit" ? "limit" : "market";
  const timeInForce = body.time_in_force === "gtc" ? "gtc" : "day";
  const limitPrice = body.limit_price != null ? Number(body.limit_price) : undefined;

  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json(
      { ok: false, error: "qty must be a positive number" },
      { status: 400 },
    );
  }
  const maxQty = Number(process.env.ALPACA_MAX_QTY ?? "10");
  if (qty > maxQty) {
    return NextResponse.json(
      { ok: false, error: `qty ${qty} exceeds ALPACA_MAX_QTY=${maxQty}` },
      { status: 400 },
    );
  }

  try {
    const creds = getCreds(); // throws if live without ALPACA_ALLOW_LIVE
    const result = await placeOrder({
      symbol,
      qty,
      side,
      type,
      time_in_force: timeInForce,
      limit_price: limitPrice,
    });
    return NextResponse.json({ ok: true, paper: creds.isPaper, order: result });
  } catch (err) {
    if (err instanceof AlpacaConfigError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof AlpacaApiError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
