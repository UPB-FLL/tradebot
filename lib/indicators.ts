// Technical indicators precomputed over a bar series.

import type { Bar } from "./data";

export interface Indicators {
  rsi: number[]; // length == bars.length, initial values default to 50
  logRet: number[]; // length == bars.length, first value 0
}

export function computeIndicators(bars: Bar[], rsiPeriod = 14): Indicators {
  const n = bars.length;
  const logRet = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    logRet[i] = Math.log(bars[i].close / bars[i - 1].close);
  }

  const rsi = new Array<number>(n).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  const alpha = 1 / rsiPeriod;
  for (let i = 1; i < n; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = avgGain + alpha * (gain - avgGain);
    avgLoss = avgLoss + alpha * (loss - avgLoss);
    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }
  return { rsi, logRet };
}
