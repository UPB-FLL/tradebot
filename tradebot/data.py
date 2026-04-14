"""Market data loader.

Tries `yfinance` first; if the download fails (offline, rate limited, etc.)
falls back to a geometric Brownian motion synthetic series so the rest of
the pipeline still works end-to-end.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd


@dataclass
class PriceSeries:
    ticker: str
    df: pd.DataFrame  # columns: open, high, low, close, volume; DatetimeIndex
    synthetic: bool = False

    def __len__(self) -> int:
        return len(self.df)


def _synthetic_series(
    ticker: str,
    start: str,
    end: str,
    s0: float = 100.0,
    mu: float = 0.08,
    sigma: float = 0.22,
    seed: int = 7,
) -> PriceSeries:
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start=start, end=end)
    n = len(dates)
    dt = 1 / 252
    shocks = rng.standard_normal(n) * sigma * np.sqrt(dt) + (mu - 0.5 * sigma**2) * dt
    log_price = np.log(s0) + np.cumsum(shocks)
    close = np.exp(log_price)
    # Fake OHLC based on intraday noise
    intraday = rng.standard_normal(n) * 0.005
    open_ = close * (1 - intraday / 2)
    high = np.maximum(open_, close) * (1 + np.abs(intraday))
    low = np.minimum(open_, close) * (1 - np.abs(intraday))
    volume = rng.integers(1_000_000, 10_000_000, size=n)
    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )
    return PriceSeries(ticker=ticker, df=df, synthetic=True)


def load_prices(
    ticker: str,
    start: str,
    end: str,
    *,
    use_synthetic_if_offline: bool = True,
    cache_dir: Optional[str | Path] = None,
) -> PriceSeries:
    """Load historical daily bars for ``ticker`` between ``start`` and ``end``."""
    cache_path: Optional[Path] = None
    if cache_dir:
        cache_path = Path(cache_dir) / f"{ticker}_{start}_{end}.parquet"
        if cache_path.exists():
            df = pd.read_parquet(cache_path)
            return PriceSeries(ticker=ticker, df=df, synthetic=False)

    df: Optional[pd.DataFrame] = None
    try:
        import yfinance as yf  # imported lazily so tests work offline

        raw = yf.download(
            ticker, start=start, end=end, progress=False, auto_adjust=True
        )
        if raw is not None and not raw.empty:
            raw = raw.rename(
                columns={
                    "Open": "open",
                    "High": "high",
                    "Low": "low",
                    "Close": "close",
                    "Volume": "volume",
                }
            )
            # yfinance may return a MultiIndex for single ticker — flatten it
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = [c[0].lower() for c in raw.columns]
            else:
                raw.columns = [str(c).lower() for c in raw.columns]
            df = raw[["open", "high", "low", "close", "volume"]].dropna()
    except Exception:
        df = None

    if df is None or df.empty:
        if not use_synthetic_if_offline:
            raise RuntimeError(
                f"Unable to download {ticker} and synthetic fallback disabled."
            )
        return _synthetic_series(ticker, start, end)

    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(cache_path)

    return PriceSeries(ticker=ticker, df=df, synthetic=False)


def extend_synthetic(series: PriceSeries, steps: int, seed: int = 11) -> PriceSeries:
    """Append ``steps`` synthetic daily bars to an existing PriceSeries.

    Used by the `paper` CLI command so we can simulate forward from the last
    historical close without contacting a broker.
    """
    rng = np.random.default_rng(seed)
    last_close = float(series.df["close"].iloc[-1])
    # Estimate sigma from the tail of real returns; fall back to 22%.
    rets = np.log(series.df["close"]).diff().dropna().tail(60)
    sigma = float(rets.std() * np.sqrt(252)) if len(rets) > 5 else 0.22
    mu = 0.06
    dt = 1 / 252
    shocks = rng.standard_normal(steps) * sigma * np.sqrt(dt) + (mu - 0.5 * sigma**2) * dt
    path = last_close * np.exp(np.cumsum(shocks))
    last_date = series.df.index[-1]
    future_dates = pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=steps)
    intraday = rng.standard_normal(steps) * 0.004
    open_ = path * (1 - intraday / 2)
    high = np.maximum(open_, path) * (1 + np.abs(intraday))
    low = np.minimum(open_, path) * (1 - np.abs(intraday))
    volume = rng.integers(1_000_000, 5_000_000, size=steps)
    future = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": path, "volume": volume},
        index=future_dates,
    )
    combined = pd.concat([series.df, future])
    return PriceSeries(ticker=series.ticker, df=combined, synthetic=series.synthetic)
