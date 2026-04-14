// Paper broker. All simulated — no real orders possible.

import { priceCall } from "./options";

export interface CallPosition {
  strike: number;
  expiryDayIndex: number; // day index (matches bars[t].t) on which this expires
  contracts: number;
  entryPrice: number;
  openedOnDayIndex: number;
}

export type TradeKind = "BUY" | "SELL" | "EXPIRE";

export interface Trade {
  kind: TradeKind;
  dayIndex: number;
  date: string;
  strike: number;
  expiryDayIndex: number;
  contracts: number;
  price: number;
  cashflow: number;
  note?: string;
}

export interface BrokerConfig {
  startingCash: number;
  commissionPerContract: number;
  slippageBps: number;
  contractMultiplier: number;
}

export class PaperBroker {
  cash: number;
  positions: CallPosition[] = [];
  trades: Trade[] = [];
  private readonly commission: number;
  private readonly slipBps: number;
  readonly multiplier: number;

  constructor(cfg: BrokerConfig) {
    this.cash = cfg.startingCash;
    this.commission = cfg.commissionPerContract;
    this.slipBps = cfg.slippageBps;
    this.multiplier = cfg.contractMultiplier;
  }

  hasPosition(): boolean {
    return this.positions.length > 0;
  }

  private slipped(price: number, side: "buy" | "sell"): number {
    const bump = price * (this.slipBps / 10_000);
    return side === "buy" ? price + bump : Math.max(price - bump, 0);
  }

  private fees(contracts: number): number {
    return this.commission * contracts;
  }

  buyCall(args: {
    dayIndex: number;
    date: string;
    strike: number;
    expiryDayIndex: number;
    contracts: number;
    quotePrice: number;
  }): Trade | null {
    let { contracts } = args;
    if (contracts <= 0) return null;
    const fill = this.slipped(args.quotePrice, "buy");
    let cost = fill * contracts * this.multiplier + this.fees(contracts);
    if (cost > this.cash) {
      const perContract = fill * this.multiplier;
      if (perContract <= 0) return null;
      contracts = Math.floor((this.cash - this.fees(1)) / perContract);
      if (contracts <= 0) return null;
      cost = fill * contracts * this.multiplier + this.fees(contracts);
    }
    this.cash -= cost;
    this.positions.push({
      strike: args.strike,
      expiryDayIndex: args.expiryDayIndex,
      contracts,
      entryPrice: fill,
      openedOnDayIndex: args.dayIndex,
    });
    const trade: Trade = {
      kind: "BUY",
      dayIndex: args.dayIndex,
      date: args.date,
      strike: args.strike,
      expiryDayIndex: args.expiryDayIndex,
      contracts,
      price: fill,
      cashflow: -cost,
    };
    this.trades.push(trade);
    return trade;
  }

  sellAll(args: {
    dayIndex: number;
    date: string;
    markFn: (p: CallPosition) => number;
  }): Trade[] {
    const closed: Trade[] = [];
    for (const pos of this.positions) {
      const mark = args.markFn(pos);
      const fill = this.slipped(mark, "sell");
      const proceeds =
        fill * pos.contracts * this.multiplier - this.fees(pos.contracts);
      this.cash += proceeds;
      const tr: Trade = {
        kind: "SELL",
        dayIndex: args.dayIndex,
        date: args.date,
        strike: pos.strike,
        expiryDayIndex: pos.expiryDayIndex,
        contracts: pos.contracts,
        price: fill,
        cashflow: proceeds,
      };
      this.trades.push(tr);
      closed.push(tr);
    }
    this.positions = [];
    return closed;
  }

  expire(args: { dayIndex: number; date: string; spot: number }): Trade[] {
    const remaining: CallPosition[] = [];
    const closed: Trade[] = [];
    for (const pos of this.positions) {
      if (pos.expiryDayIndex <= args.dayIndex) {
        const intrinsic = Math.max(args.spot - pos.strike, 0);
        const proceeds = intrinsic * pos.contracts * this.multiplier;
        this.cash += proceeds;
        const tr: Trade = {
          kind: "EXPIRE",
          dayIndex: args.dayIndex,
          date: args.date,
          strike: pos.strike,
          expiryDayIndex: pos.expiryDayIndex,
          contracts: pos.contracts,
          price: intrinsic,
          cashflow: proceeds,
          note: intrinsic > 0 ? "ITM" : "OTM",
        };
        this.trades.push(tr);
        closed.push(tr);
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
    return closed;
  }

  markToMarket(args: {
    spot: number;
    dayIndex: number;
    r: number;
    sigma: number;
  }): number {
    let total = this.cash;
    for (const pos of this.positions) {
      const days = Math.max(pos.expiryDayIndex - args.dayIndex, 0);
      const t = days / 365;
      const quote = priceCall(args.spot, pos.strike, t, args.r, args.sigma);
      total += quote.price * pos.contracts * this.multiplier;
    }
    return total;
  }
}
