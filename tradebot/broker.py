"""Paper broker + portfolio.

Pure in-memory simulation. Cannot place real orders — no network calls.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional

from .options import CallQuote, price_call


@dataclass
class CallPosition:
    ticker: str
    strike: float
    expiry: date           # absolute expiry date
    contracts: int         # long-only for this MVP (contracts > 0)
    entry_price: float     # per-share option premium paid
    opened_on: date


@dataclass
class Trade:
    kind: str              # "BUY" or "SELL" or "EXPIRE"
    dt: date
    ticker: str
    strike: float
    expiry: date
    contracts: int
    price: float           # per-share option premium
    cashflow: float        # signed cash effect including fees/slippage
    note: str = ""


@dataclass
class PaperBroker:
    cash: float
    commission_per_contract: float = 0.65
    slippage_bps: float = 5.0
    contract_multiplier: int = 100
    positions: List[CallPosition] = field(default_factory=list)
    trades: List[Trade] = field(default_factory=list)

    # --- helpers ---------------------------------------------------------

    def _apply_slippage(self, price: float, side: str) -> float:
        bump = price * (self.slippage_bps / 10_000.0)
        return price + bump if side == "buy" else max(price - bump, 0.0)

    def _fees(self, contracts: int) -> float:
        return self.commission_per_contract * contracts

    # --- trading --------------------------------------------------------

    def buy_call(
        self,
        *,
        dt: date,
        ticker: str,
        strike: float,
        expiry: date,
        contracts: int,
        quote_price: float,
    ) -> Optional[Trade]:
        if contracts <= 0:
            return None
        fill = self._apply_slippage(quote_price, "buy")
        cost = fill * contracts * self.contract_multiplier + self._fees(contracts)
        if cost > self.cash:
            # Scale down to what we can afford; if nothing, bail.
            affordable = int(
                (self.cash - self._fees(1))
                // max(fill * self.contract_multiplier, 1e-9)
            )
            if affordable <= 0:
                return None
            contracts = affordable
            cost = fill * contracts * self.contract_multiplier + self._fees(contracts)

        self.cash -= cost
        pos = CallPosition(
            ticker=ticker, strike=strike, expiry=expiry,
            contracts=contracts, entry_price=fill, opened_on=dt,
        )
        self.positions.append(pos)
        trade = Trade(kind="BUY", dt=dt, ticker=ticker, strike=strike,
                      expiry=expiry, contracts=contracts, price=fill,
                      cashflow=-cost)
        self.trades.append(trade)
        return trade

    def sell_all(self, *, dt: date, quote_fn) -> List[Trade]:
        """Close every open position at the price returned by ``quote_fn(pos)``."""
        closed: List[Trade] = []
        keep: List[CallPosition] = []
        for pos in self.positions:
            mark = quote_fn(pos)
            fill = self._apply_slippage(mark, "sell")
            proceeds = fill * pos.contracts * self.contract_multiplier - self._fees(pos.contracts)
            self.cash += proceeds
            trade = Trade(kind="SELL", dt=dt, ticker=pos.ticker,
                          strike=pos.strike, expiry=pos.expiry,
                          contracts=pos.contracts, price=fill,
                          cashflow=proceeds)
            self.trades.append(trade)
            closed.append(trade)
        self.positions = keep
        return closed

    def expire(self, *, dt: date, spot: float) -> List[Trade]:
        """Settle any positions expiring on ``dt`` at intrinsic value."""
        closed: List[Trade] = []
        remaining: List[CallPosition] = []
        for pos in self.positions:
            if pos.expiry <= dt:
                intrinsic = max(spot - pos.strike, 0.0)
                proceeds = intrinsic * pos.contracts * self.contract_multiplier
                self.cash += proceeds
                trade = Trade(kind="EXPIRE", dt=dt, ticker=pos.ticker,
                              strike=pos.strike, expiry=pos.expiry,
                              contracts=pos.contracts, price=intrinsic,
                              cashflow=proceeds,
                              note="ITM" if intrinsic > 0 else "OTM")
                self.trades.append(trade)
                closed.append(trade)
            else:
                remaining.append(pos)
        self.positions = remaining
        return closed

    # --- valuation ------------------------------------------------------

    def mark_to_market(
        self, *, spot: float, dt: date, r: float, sigma: float
    ) -> float:
        """Return total portfolio value (cash + BS-valued positions)."""
        total = self.cash
        for pos in self.positions:
            days = max((pos.expiry - dt).days, 0)
            t = days / 365.0
            quote: CallQuote = price_call(spot, pos.strike, t, r, sigma)
            total += quote.price * pos.contracts * self.contract_multiplier
        return total

    def has_position(self) -> bool:
        return len(self.positions) > 0
