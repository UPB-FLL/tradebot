import { NextRequest, NextResponse } from "next/server";
import {
  AlpacaApiError,
  AlpacaConfigError,
  getLatestTrade,
  listCallContracts,
} from "@/lib/alpaca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/broker/contracts?underlying=SPY&offsetPct=0.02&minDte=21&maxDte=45
 *
 * Returns the nearest-to-money call contracts around `spot * (1 + offsetPct)`,
 * filtered to contracts expiring in the requested DTE window. Sorted so the
 * closest strike comes first.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const underlying = (url.searchParams.get("underlying") || "SPY").toUpperCase();
  const offsetPct = Number(url.searchParams.get("offsetPct") ?? "0.02");
  const minDte = Math.max(0, Number(url.searchParams.get("minDte") ?? "21"));
  const maxDte = Math.max(
    minDte,
    Number(url.searchParams.get("maxDte") ?? "45"),
  );

  try {
    const trade = await getLatestTrade(underlying);
    const today = new Date();
    const after = new Date(today);
    after.setUTCDate(after.getUTCDate() + minDte);
    const before = new Date(today);
    before.setUTCDate(before.getUTCDate() + maxDte);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const spot = trade?.price;
    const target = spot ? spot * (1 + offsetPct) : undefined;
    const contracts = await listCallContracts({
      underlying,
      expirationOnOrAfter: fmt(after),
      expirationOnOrBefore: fmt(before),
      minStrike: target ? target * 0.9 : undefined,
      maxStrike: target ? target * 1.1 : undefined,
      limit: 100,
    });

    const sorted = target
      ? contracts.slice().sort((a, b) => {
          const da = Math.abs(Number(a.strike_price) - target);
          const db = Math.abs(Number(b.strike_price) - target);
          return da - db;
        })
      : contracts;

    return NextResponse.json({
      ok: true,
      underlying,
      spot,
      target,
      contracts: sorted.slice(0, 20),
    });
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
