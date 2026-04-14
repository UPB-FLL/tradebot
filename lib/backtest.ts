// Episode runner shared by training and evaluation.

import type { QAgent } from "./agent";
import type { Trade } from "./broker";
import { type OptionsEnv, type State } from "./env";
import type { RsiStrategy } from "./strategy";

export interface EquityPoint {
  dayIndex: number;
  date: string;
  spot: number;
  equity: number;
}

export interface EpisodeResult {
  finalEquity: number;
  totalReward: number;
  trades: Trade[];
  equityCurve: EquityPoint[];
  nBuys: number;
  nSells: number;
  expiredItm: number;
  expiredOtm: number;
}

export type Policy = (state: State, env: OptionsEnv) => number;

export function agentPolicy(agent: QAgent, explore: boolean): Policy {
  return (state) => agent.act(state, explore);
}

export function rsiPolicy(strategy: RsiStrategy): Policy {
  return (state, env) => strategy.act(state, env);
}

export function runEpisode(
  env: OptionsEnv,
  policy: Policy,
  opts: { learn?: QAgent } = {},
): EpisodeResult {
  let state = env.reset();
  const firstBar = env.series.bars[env.warmup];
  const equityCurve: EquityPoint[] = [
    {
      dayIndex: firstBar?.t ?? 0,
      date: firstBar?.date ?? "",
      spot: firstBar?.close ?? 0,
      equity: env.equity,
    },
  ];
  let totalReward = 0;
  let done = false;

  while (!done) {
    const action = policy(state, env);
    const out = env.step(action);
    if (opts.learn) {
      opts.learn.update(state, action, out.reward, out.state, out.done);
    }
    state = out.state;
    totalReward += out.reward;
    equityCurve.push({
      dayIndex: out.info.dayIndex,
      date: out.info.date,
      spot: out.info.spot,
      equity: out.info.equity,
    });
    done = out.done;
  }

  const trades = env.broker.trades;
  return {
    finalEquity: env.equity,
    totalReward,
    trades,
    equityCurve,
    nBuys: trades.filter((t) => t.kind === "BUY").length,
    nSells: trades.filter((t) => t.kind === "SELL").length,
    expiredItm: trades.filter((t) => t.kind === "EXPIRE" && t.note === "ITM")
      .length,
    expiredOtm: trades.filter((t) => t.kind === "EXPIRE" && t.note === "OTM")
      .length,
  };
}
