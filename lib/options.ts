// Black-Scholes call pricer + greeks. Pure math, no deps.

export interface CallQuote {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per year
  vega: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation. Accurate to ~1e-7.
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Price a European call. `t` is years to expiration. */
export function priceCall(
  s: number,
  k: number,
  t: number,
  r: number,
  sigma: number,
): CallQuote {
  if (t <= 0 || sigma <= 0) {
    const intrinsic = Math.max(s - k, 0);
    return {
      price: intrinsic,
      delta: s > k ? 1 : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = normCdf(d1);
  const nd2 = normCdf(d2);
  const pdf1 = normPdf(d1);
  const price = s * nd1 - k * Math.exp(-r * t) * nd2;
  return {
    price,
    delta: nd1,
    gamma: pdf1 / (s * sigma * sqrtT),
    theta:
      -(s * pdf1 * sigma) / (2 * sqrtT) - r * k * Math.exp(-r * t) * nd2,
    vega: s * pdf1 * sqrtT,
  };
}

/** Nearest-dollar strike offset_pct above spot (positive = OTM). */
export function chooseStrike(spot: number, offsetPct: number): number {
  return Math.round(spot * (1 + offsetPct));
}
