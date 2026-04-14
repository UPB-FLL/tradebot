"""Black–Scholes call option pricing + greeks.

Only European calls are modelled, which is what we trade (buy then sell before
expiration, or let expire worthless). All math is closed-form; no numerical
integration needed for the MVP.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


SQRT_2PI = math.sqrt(2.0 * math.pi)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_2PI


@dataclass
class CallQuote:
    price: float
    delta: float
    gamma: float
    theta: float   # per year; divide by 365 for daily
    vega: float    # per 1.00 change in sigma
    d1: float
    d2: float


def price_call(
    s: float,   # spot
    k: float,   # strike
    t: float,   # time to expiration in YEARS
    r: float,   # risk-free rate
    sigma: float,
) -> CallQuote:
    """Return the Black–Scholes price and greeks for a European call.

    Handles the ``t == 0`` edge case (expiration day) by returning intrinsic value.
    """
    if t <= 0 or sigma <= 0:
        intrinsic = max(s - k, 0.0)
        delta = 1.0 if s > k else 0.0
        return CallQuote(price=intrinsic, delta=delta, gamma=0.0, theta=0.0,
                         vega=0.0, d1=float("nan"), d2=float("nan"))

    sqrt_t = math.sqrt(t)
    d1 = (math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    nd1 = _norm_cdf(d1)
    nd2 = _norm_cdf(d2)
    pdf1 = _norm_pdf(d1)

    price = s * nd1 - k * math.exp(-r * t) * nd2
    delta = nd1
    gamma = pdf1 / (s * sigma * sqrt_t)
    theta = (-(s * pdf1 * sigma) / (2 * sqrt_t)
             - r * k * math.exp(-r * t) * nd2)
    vega = s * pdf1 * sqrt_t
    return CallQuote(price=price, delta=delta, gamma=gamma, theta=theta,
                     vega=vega, d1=d1, d2=d2)


def choose_strike(spot: float, offset_pct: float) -> float:
    """Round strike to nearest $1 increment, offset_pct OTM (positive = above spot)."""
    raw = spot * (1.0 + offset_pct)
    return round(raw)
