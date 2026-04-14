import { NextResponse } from "next/server";
import {
  AlpacaApiError,
  AlpacaConfigError,
  getPositions,
} from "@/lib/alpaca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const positions = await getPositions();
    return NextResponse.json({ ok: true, positions });
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
