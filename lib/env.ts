// RL environment for call-option trading (pure TS port of tradebot/env.py).

import { PaperBroker, type BrokerConfig } from "./broker";
import type { PriceSeries } from "./data";
import { computeIndicators, type Indicators } from "./indicators";
import { chooseStrike, priceCall } from "./options";

export const HOLD = 0;
export const BUY_CALL = 1;
export const SELL = 2;
export const N_ACTIONS = 3;

export type State = [number, number, number]; // (rsi_bin, ret_bin, pos_bin)

export interface EnvConfig extends BrokerConfig {
  riskFreeRate: number;
  impliedVol: number;
  dteDays: number;
  strikeOffsetPct: number;
  rsiBins: number[]; // ascending edges, e.g. [30, 50, 70]
  retBins: number[]; // ascending edges
  warmup?: number;
  riskPerTradePct?: number; // fraction of cash used per new position
}

function binIndex(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) {
    if (value < edges[i]) return i;
  }
  return edges.length;
}

export interface StepInfo {
  dayIndex: number;
  date: string;
  spot: number;
  action: number;
  equity: number;
}

export class OptionsEnv {
  readonly series: PriceSeries;
  readonly cfg: EnvConfig;
  readonly indicators: Indicators;
  readonly warmup: number;
  broker: PaperBroker;
  t: number;
  prevEquity: number;

  constructor(series: PriceSeries, cfg: EnvConfig) {
    this.series = series;
    this.cfg = cfg;
    this.indicators = computeIndicators(series.bars);
    this.warmup = cfg.warmup ?? 20;
    this.broker = new PaperBroker(cfg);
    this.t = this.warmup;
    this.prevEquity = this.broker.cash;
  }

  reset(): State {
    this.broker = new PaperBroker(this.cfg);
    this.t = this.warmup;
    this.prevEquity = this.broker.cash;
    return this.state();
  }

  step(action: number): {
    state: State;
    reward: number;
    done: boolean;
    info: StepInfo;
  } {
    const bar = this.series.bars[this.t];
    const spot = bar.close;

    this.broker.expire({ dayIndex: bar.t, date: bar.date, spot });

    if (action === BUY_CALL && !this.broker.hasPosition()) {
      const strike = chooseStrike(spot, this.cfg.strikeOffsetPct);
      const expiryDayIndex = bar.t + this.cfg.dteDays;
      const tYears = this.cfg.dteDays / 365;
      const quote = priceCall(
        spot,
        strike,
        tYears,
        this.cfg.riskFreeRate,
        this.cfg.impliedVol,
      );
      const notional = (this.cfg.riskPerTradePct ?? 0.05) * this.broker.cash;
      const perContractCost = quote.price * this.broker.multiplier;
      if (perContractCost > 0) {
        const contracts = Math.max(
          1,
          Math.floor(notional / perContractCost),
        );
        this.broker.buyCall({
          dayIndex: bar.t,
          date: bar.date,
          strike,
          expiryDayIndex,
          contracts,
          quotePrice: quote.price,
        });
      }
    } else if (action === SELL && this.broker.hasPosition()) {
      this.broker.sellAll({
        dayIndex: bar.t,
        date: bar.date,
        markFn: (p) => this.mark(p, bar.t, spot),
      });
    }

    this.t += 1;
    const done = this.t >= this.series.bars.length - 1;
    const nextBar = this.series.bars[this.t];
    const nextSpot = nextBar.close;

    let equity = this.broker.markToMarket({
      spot: nextSpot,
      dayIndex: nextBar.t,
      r: this.cfg.riskFreeRate,
      sigma: this.cfg.impliedVol,
    });
    let reward = equity - this.prevEquity;
    this.prevEquity = equity;

    if (done) {
      this.broker.expire({
        dayIndex: nextBar.t,
        date: nextBar.date,
        spot: nextSpot,
      });
      this.broker.sellAll({
        dayIndex: nextBar.t,
        date: nextBar.date,
        markFn: (p) => this.mark(p, nextBar.t, nextSpot),
      });
      equity = this.broker.cash;
      reward += equity - this.prevEquity;
      this.prevEquity = equity;
    }

    const info: StepInfo = {
      dayIndex: nextBar.t,
      date: nextBar.date,
      spot: nextSpot,
      action,
      equity,
    };
    return { state: this.state(), reward, done, info };
  }

  mark(pos: { strike: number; expiryDayIndex: number }, dayIndex: number, spot: number): number {
    const days = Math.max(pos.expiryDayIndex - dayIndex, 0);
    const tYears = days / 365;
    return priceCall(
      spot,
      pos.strike,
      tYears,
      this.cfg.riskFreeRate,
      this.cfg.impliedVol,
    ).price;
  }

  state(): State {
    const i = Math.min(this.t, this.series.bars.length - 1);
    const r = this.indicators.rsi[i];
    const ret = this.indicators.logRet[i];
    const pos = this.broker.hasPosition() ? 1 : 0;
    return [binIndex(r, this.cfg.rsiBins), binIndex(ret, this.cfg.retBins), pos];
  }

  get equity(): number {
    return this.prevEquity;
  }
}
