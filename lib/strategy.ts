// Rule-based RSI baseline (TS port of tradebot/strategy.py).

import { BUY_CALL, HOLD, OptionsEnv, SELL, type State } from "./env";

export interface RsiStrategyOptions {
  rsiBuyBelow?: number;
  rsiSellAbove?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}

export class RsiStrategy {
  rsiBuyBelow: number;
  rsiSellAbove: number;
  takeProfitPct: number;
  stopLossPct: number;

  constructor(opts: RsiStrategyOptions = {}) {
    this.rsiBuyBelow = opts.rsiBuyBelow ?? 35;
    this.rsiSellAbove = opts.rsiSellAbove ?? 65;
    this.takeProfitPct = opts.takeProfitPct ?? 0.25;
    this.stopLossPct = opts.stopLossPct ?? 0.2;
  }

  act(_state: State, env: OptionsEnv): number {
    const i = Math.min(env.t, env.series.bars.length - 1);
    const rsi = env.indicators.rsi[i];
    const hasPos = env.broker.hasPosition();

    if (hasPos) {
      const pos = env.broker.positions[0];
      const spot = env.series.bars[i].close;
      const mark = env.mark(pos, env.series.bars[i].t, spot);
      const pnlPct = (mark - pos.entryPrice) / Math.max(pos.entryPrice, 1e-6);
      if (pnlPct >= this.takeProfitPct || pnlPct <= -this.stopLossPct) {
        return SELL;
      }
      if (rsi >= this.rsiSellAbove) return SELL;
      return HOLD;
    }

    if (rsi <= this.rsiBuyBelow) return BUY_CALL;
    return HOLD;
  }
}
