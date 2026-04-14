// Synthetic OHLC generator. Browser-friendly (no network). GBM with intraday noise.

import { Rng } from "./rng";

export interface Bar {
  t: number; // day index (0-based)
  date: string; // YYYY-MM-DD label (synthetic business-day walk)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceSeries {
  ticker: string;
  bars: Bar[];
}

export interface SyntheticParams {
  ticker: string;
  days: number;
  s0: number;
  mu: number; // annualized drift
  sigma: number; // annualized vol
  seed: number;
  startDate?: string; // YYYY-MM-DD
}

function addBusinessDays(start: Date, offset: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < offset) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function syntheticSeries(p: SyntheticParams): PriceSeries {
  const rng = new Rng(p.seed);
  const dt = 1 / 252;
  const drift = (p.mu - 0.5 * p.sigma * p.sigma) * dt;
  const diffusion = p.sigma * Math.sqrt(dt);

  const startDate = p.startDate
    ? new Date(p.startDate + "T00:00:00Z")
    : new Date("2022-01-03T00:00:00Z");

  let logPrice = Math.log(p.s0);
  const bars: Bar[] = [];
  for (let i = 0; i < p.days; i++) {
    logPrice += drift + diffusion * rng.normal();
    const close = Math.exp(logPrice);
    const intraday = rng.normal() * 0.005;
    const open = close * (1 - intraday / 2);
    const high = Math.max(open, close) * (1 + Math.abs(intraday));
    const low = Math.min(open, close) * (1 - Math.abs(intraday));
    const volume = 1_000_000 + rng.nextInt(9_000_000);
    const d = addBusinessDays(startDate, i);
    bars.push({ t: i, date: fmt(d), open, high, low, close, volume });
  }
  return { ticker: p.ticker, bars };
}
