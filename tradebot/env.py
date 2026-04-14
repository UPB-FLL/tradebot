"""Reinforcement learning environment for training an options-calls agent.

The environment wraps a PriceSeries + PaperBroker and exposes a Gym-like
``reset`` / ``step`` API. States are discrete tuples so we can use tabular
Q-learning without deep-learning dependencies.

Actions
-------
0 = HOLD           (do nothing this bar)
1 = BUY_CALL       (open a fresh call position if flat)
2 = SELL           (close all open positions)

Reward
------
Change in portfolio equity (mark-to-market) between the previous and current
bar, in dollars. Terminal state returns the final equity delta.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from .broker import PaperBroker
from .data import PriceSeries
from .indicators import log_returns, rsi
from .options import choose_strike, price_call

HOLD, BUY_CALL, SELL = 0, 1, 2
N_ACTIONS = 3

State = Tuple[int, int, int]  # (rsi_bin, return_bin, position_bin)


@dataclass
class EnvConfig:
    starting_cash: float
    commission_per_contract: float
    slippage_bps: float
    contract_multiplier: int
    risk_free_rate: float
    implied_volatility: float
    dte_days: int
    strike_offset_pct: float
    rsi_bins: list
    ret_bins: list


def _bin(value: float, edges: list) -> int:
    for i, edge in enumerate(edges):
        if value < edge:
            return i
    return len(edges)


class OptionsEnv:
    """Single-ticker options trading environment."""

    def __init__(self, series: PriceSeries, cfg: EnvConfig, warmup: int = 20):
        self.series = series
        self.cfg = cfg
        self.warmup = warmup

        close = series.df["close"]
        self._close = close.values.astype(float)
        self._dates = series.df.index
        self._rsi = rsi(close).values
        self._ret = log_returns(close).values

        # Per-episode state
        self.broker: Optional[PaperBroker] = None
        self.t: int = 0
        self.prev_equity: float = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self) -> State:
        self.broker = PaperBroker(
            cash=self.cfg.starting_cash,
            commission_per_contract=self.cfg.commission_per_contract,
            slippage_bps=self.cfg.slippage_bps,
            contract_multiplier=self.cfg.contract_multiplier,
        )
        self.t = self.warmup
        self.prev_equity = self.broker.cash
        return self._state()

    def step(self, action: int) -> Tuple[State, float, bool, dict]:
        assert self.broker is not None, "Call reset() first"
        dt = self._dates[self.t].date()
        spot = float(self._close[self.t])

        # 1. Let any expiring positions settle at today's spot BEFORE acting.
        self.broker.expire(dt=dt, spot=spot)

        info = {"dt": dt, "spot": spot, "action": action}

        # 2. Execute the action.
        if action == BUY_CALL and not self.broker.has_position():
            strike = choose_strike(spot, self.cfg.strike_offset_pct)
            expiry = dt + timedelta(days=self.cfg.dte_days)
            t_years = self.cfg.dte_days / 365.0
            quote = price_call(
                spot, strike, t_years,
                self.cfg.risk_free_rate, self.cfg.implied_volatility,
            )
            # Size: risk ~5% of cash per trade
            notional = 0.05 * self.broker.cash
            per_contract_cost = quote.price * self.cfg.contract_multiplier
            contracts = max(1, int(notional // max(per_contract_cost, 1e-6))) \
                if per_contract_cost > 0 else 0
            if contracts > 0:
                self.broker.buy_call(
                    dt=dt, ticker=self.series.ticker, strike=strike,
                    expiry=expiry, contracts=contracts,
                    quote_price=quote.price,
                )
        elif action == SELL and self.broker.has_position():
            self.broker.sell_all(dt=dt, quote_fn=lambda p: self._mark(p, dt, spot))

        # 3. Advance time.
        self.t += 1
        done = self.t >= len(self._close) - 1
        next_dt = self._dates[self.t].date()
        next_spot = float(self._close[self.t])

        equity = self.broker.mark_to_market(
            spot=next_spot, dt=next_dt,
            r=self.cfg.risk_free_rate, sigma=self.cfg.implied_volatility,
        )
        reward = equity - self.prev_equity
        self.prev_equity = equity

        if done:
            # Liquidate everything at the final bar so reward reflects reality.
            self.broker.expire(dt=next_dt, spot=next_spot)
            self.broker.sell_all(
                dt=next_dt, quote_fn=lambda p: self._mark(p, next_dt, next_spot)
            )
            equity = self.broker.cash
            reward += (equity - self.prev_equity)
            self.prev_equity = equity

        info["equity"] = equity
        return self._state(), float(reward), done, info

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _mark(self, pos, dt, spot: float) -> float:
        days = max((pos.expiry - dt).days, 0)
        t = days / 365.0
        return price_call(
            spot, pos.strike, t,
            self.cfg.risk_free_rate, self.cfg.implied_volatility,
        ).price

    def _state(self) -> State:
        assert self.broker is not None
        i = min(self.t, len(self._close) - 1)
        r = float(self._rsi[i]) if not np.isnan(self._rsi[i]) else 50.0
        ret = float(self._ret[i]) if not np.isnan(self._ret[i]) else 0.0
        pos_bin = 1 if self.broker.has_position() else 0
        return (_bin(r, self.cfg.rsi_bins),
                _bin(ret, self.cfg.ret_bins),
                pos_bin)

    @property
    def equity(self) -> float:
        return self.prev_equity
