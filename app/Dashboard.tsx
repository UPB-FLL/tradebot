"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { QAgent } from "@/lib/agent";
import {
  agentPolicy,
  runEpisode,
  rsiPolicy,
  type EpisodeResult,
} from "@/lib/backtest";
import { syntheticSeries, type PriceSeries } from "@/lib/data";
import { OptionsEnv, type EnvConfig } from "@/lib/env";
import { RsiStrategy } from "@/lib/strategy";

type Tab = "backtest" | "train";

interface Controls {
  ticker: string;
  days: number;
  s0: number;
  mu: number;
  sigma: number;
  dataSeed: number;
  startingCash: number;
  commission: number;
  slippageBps: number;
  dte: number;
  strikeOffset: number;
  iv: number;
  rfRate: number;
  episodes: number;
  agentSeed: number;
  alpha: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  epsilonDecay: number;
  rsiBuyBelow: number;
  rsiSellAbove: number;
  takeProfit: number;
  stopLoss: number;
}

const DEFAULTS: Controls = {
  ticker: "SYN",
  days: 500,
  s0: 100,
  mu: 0.08,
  sigma: 0.22,
  dataSeed: 7,
  startingCash: 100_000,
  commission: 0.65,
  slippageBps: 5,
  dte: 30,
  strikeOffset: 0.02,
  iv: 0.22,
  rfRate: 0.045,
  episodes: 150,
  agentSeed: 42,
  alpha: 0.1,
  gamma: 0.97,
  epsilonStart: 1.0,
  epsilonEnd: 0.05,
  epsilonDecay: 0.995,
  rsiBuyBelow: 35,
  rsiSellAbove: 65,
  takeProfit: 0.25,
  stopLoss: 0.2,
};

function buildEnvConfig(c: Controls): EnvConfig {
  return {
    startingCash: c.startingCash,
    commissionPerContract: c.commission,
    slippageBps: c.slippageBps,
    contractMultiplier: 100,
    riskFreeRate: c.rfRate,
    impliedVol: c.iv,
    dteDays: c.dte,
    strikeOffsetPct: c.strikeOffset,
    rsiBins: [30, 50, 70],
    retBins: [-0.02, 0, 0.02],
    warmup: 20,
    riskPerTradePct: 0.05,
  };
}

function buildSeries(c: Controls): PriceSeries {
  return syntheticSeries({
    ticker: c.ticker,
    days: c.days,
    s0: c.s0,
    mu: c.mu,
    sigma: c.sigma,
    seed: c.dataSeed,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

export default function Dashboard() {
  const [controls, setControls] = useState<Controls>(DEFAULTS);
  const [tab, setTab] = useState<Tab>("backtest");
  const [agent, setAgent] = useState<QAgent | null>(null);
  const [trainingProgress, setTrainingProgress] = useState<number | null>(null);
  const [trainingLog, setTrainingLog] = useState<string[]>([]);
  const [result, setResult] = useState<EpisodeResult | null>(null);
  const [resultSource, setResultSource] = useState<string>("");
  const [useAgent, setUseAgent] = useState(false);

  const update = <K extends keyof Controls>(k: K, v: Controls[K]) =>
    setControls((c) => ({ ...c, [k]: v }));

  const series = useMemo(() => buildSeries(controls), [controls]);
  const envCfg = useMemo(() => buildEnvConfig(controls), [controls]);

  function runBacktest() {
    const env = new OptionsEnv(series, envCfg);
    let source: string;
    let policy;
    if (useAgent && agent) {
      policy = agentPolicy(agent, false);
      source = "Trained agent";
    } else {
      const strat = new RsiStrategy({
        rsiBuyBelow: controls.rsiBuyBelow,
        rsiSellAbove: controls.rsiSellAbove,
        takeProfitPct: controls.takeProfit,
        stopLossPct: controls.stopLoss,
      });
      policy = rsiPolicy(strat);
      source = "RSI baseline";
    }
    const res = runEpisode(env, policy);
    setResult(res);
    setResultSource(source);
  }

  async function runTraining() {
    setTrainingProgress(0);
    setTrainingLog([]);
    const a = new QAgent({
      alpha: controls.alpha,
      gamma: controls.gamma,
      epsilon: controls.epsilonStart,
      epsilonEnd: controls.epsilonEnd,
      epsilonDecay: controls.epsilonDecay,
      seed: controls.agentSeed,
    });
    const total = controls.episodes;
    let best = -Infinity;
    const env = new OptionsEnv(series, envCfg);

    // Chunk episodes so the UI can repaint between batches.
    const chunkSize = Math.max(1, Math.floor(total / 30));
    for (let ep = 1; ep <= total; ep += chunkSize) {
      const end = Math.min(total, ep + chunkSize - 1);
      let last: EpisodeResult | null = null;
      for (let i = ep; i <= end; i++) {
        last = runEpisode(env, agentPolicy(a, true), { learn: a });
        a.decayEpsilon();
        if (last.finalEquity > best) best = last.finalEquity;
      }
      setTrainingProgress(end / total);
      setTrainingLog((log) => [
        ...log,
        `ep ${end.toString().padStart(4)}/${total}  ε=${a.epsilon.toFixed(3)}  equity=${fmtMoney(last!.finalEquity)}  best=${fmtMoney(best)}`,
      ]);
      // yield to the event loop
      await new Promise((r) => setTimeout(r, 0));
    }

    setAgent(a);
    setTrainingProgress(1);
    setTrainingLog((log) => [
      ...log,
      `Done. |Q| = ${a.q.size} state-action pairs. Agent ready — flip "Use trained agent" on the Backtest tab.`,
    ]);
    setUseAgent(true);
    setTab("backtest");
  }

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.equityCurve.map((p) => ({
      date: p.date,
      equity: Math.round(p.equity),
      spot: Math.round(p.spot * 100) / 100,
    }));
  }, [result]);

  const pnl = result ? result.finalEquity - controls.startingCash : 0;
  const pnlPct = result ? pnl / controls.startingCash : 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>tradebot</h1>
        <p className="tagline" style={{ color: "var(--muted)", marginTop: 0 }}>
          call-options paper-trading sim
        </p>

        <div className="disclaimer">
          Simulation only. No real brokerage, no real orders. Synthetic GBM
          price path for in-browser training on Vercel.
        </div>

        <div className="section">
          <h2>Market</h2>
          <div className="field-grid">
            <div>
              <label>Ticker</label>
              <input
                type="text"
                value={controls.ticker}
                onChange={(e) => update("ticker", e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label>Days</label>
              <input
                type="number"
                value={controls.days}
                min={60}
                max={2000}
                onChange={(e) => update("days", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Start price</label>
              <input
                type="number"
                value={controls.s0}
                step={1}
                onChange={(e) => update("s0", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Data seed</label>
              <input
                type="number"
                value={controls.dataSeed}
                onChange={(e) => update("dataSeed", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Drift μ</label>
              <input
                type="number"
                step={0.01}
                value={controls.mu}
                onChange={(e) => update("mu", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Vol σ</label>
              <input
                type="number"
                step={0.01}
                value={controls.sigma}
                onChange={(e) => update("sigma", Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="section">
          <h2>Options</h2>
          <div className="field-grid">
            <div>
              <label>DTE days</label>
              <input
                type="number"
                value={controls.dte}
                onChange={(e) => update("dte", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Strike offset</label>
              <input
                type="number"
                step={0.005}
                value={controls.strikeOffset}
                onChange={(e) =>
                  update("strikeOffset", Number(e.target.value))
                }
              />
            </div>
            <div>
              <label>Implied vol</label>
              <input
                type="number"
                step={0.01}
                value={controls.iv}
                onChange={(e) => update("iv", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Risk-free r</label>
              <input
                type="number"
                step={0.005}
                value={controls.rfRate}
                onChange={(e) => update("rfRate", Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="section">
          <h2>Broker</h2>
          <div className="field-grid">
            <div>
              <label>Cash $</label>
              <input
                type="number"
                value={controls.startingCash}
                step={1000}
                onChange={(e) =>
                  update("startingCash", Number(e.target.value))
                }
              />
            </div>
            <div>
              <label>Commission</label>
              <input
                type="number"
                step={0.05}
                value={controls.commission}
                onChange={(e) => update("commission", Number(e.target.value))}
              />
            </div>
            <div>
              <label>Slippage bps</label>
              <input
                type="number"
                step={1}
                value={controls.slippageBps}
                onChange={(e) =>
                  update("slippageBps", Number(e.target.value))
                }
              />
            </div>
          </div>
        </div>

        {tab === "train" ? (
          <div className="section">
            <h2>RL hyperparameters</h2>
            <div className="field-grid">
              <div>
                <label>Episodes</label>
                <input
                  type="number"
                  value={controls.episodes}
                  onChange={(e) => update("episodes", Number(e.target.value))}
                />
              </div>
              <div>
                <label>Agent seed</label>
                <input
                  type="number"
                  value={controls.agentSeed}
                  onChange={(e) => update("agentSeed", Number(e.target.value))}
                />
              </div>
              <div>
                <label>α (learning rate)</label>
                <input
                  type="number"
                  step={0.01}
                  value={controls.alpha}
                  onChange={(e) => update("alpha", Number(e.target.value))}
                />
              </div>
              <div>
                <label>γ (discount)</label>
                <input
                  type="number"
                  step={0.01}
                  value={controls.gamma}
                  onChange={(e) => update("gamma", Number(e.target.value))}
                />
              </div>
              <div>
                <label>ε start</label>
                <input
                  type="number"
                  step={0.05}
                  value={controls.epsilonStart}
                  onChange={(e) =>
                    update("epsilonStart", Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label>ε end</label>
                <input
                  type="number"
                  step={0.01}
                  value={controls.epsilonEnd}
                  onChange={(e) =>
                    update("epsilonEnd", Number(e.target.value))
                  }
                />
              </div>
              <div className="full">
                <label>ε decay</label>
                <input
                  type="number"
                  step={0.001}
                  value={controls.epsilonDecay}
                  onChange={(e) =>
                    update("epsilonDecay", Number(e.target.value))
                  }
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="section">
            <h2>RSI baseline</h2>
            <div className="field-grid">
              <div>
                <label>Buy below</label>
                <input
                  type="number"
                  value={controls.rsiBuyBelow}
                  onChange={(e) =>
                    update("rsiBuyBelow", Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label>Sell above</label>
                <input
                  type="number"
                  value={controls.rsiSellAbove}
                  onChange={(e) =>
                    update("rsiSellAbove", Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label>Take profit</label>
                <input
                  type="number"
                  step={0.05}
                  value={controls.takeProfit}
                  onChange={(e) =>
                    update("takeProfit", Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label>Stop loss</label>
                <input
                  type="number"
                  step={0.05}
                  value={controls.stopLoss}
                  onChange={(e) =>
                    update("stopLoss", Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={useAgent}
                  disabled={!agent}
                  onChange={(e) => setUseAgent(e.target.checked)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Use trained agent {agent ? `(|Q|=${agent.q.size})` : "(train first)"}
              </label>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        <div className="tabs">
          <button
            className={`tab ${tab === "backtest" ? "active" : ""}`}
            onClick={() => setTab("backtest")}
          >
            Backtest
          </button>
          <button
            className={`tab ${tab === "train" ? "active" : ""}`}
            onClick={() => setTab("train")}
          >
            Train
          </button>
        </div>

        {tab === "backtest" && (
          <>
            <div className="btn-row">
              <button onClick={runBacktest}>Run backtest</button>
              <button
                className="secondary"
                onClick={() => {
                  setResult(null);
                  setResultSource("");
                }}
              >
                Clear
              </button>
            </div>

            {result && (
              <>
                <h2 style={{ marginTop: 20 }}>
                  Result · {resultSource}
                </h2>
                <div className="stat-row">
                  <div className="stat">
                    <div className="label">Final equity</div>
                    <div className="value">{fmtMoney(result.finalEquity)}</div>
                  </div>
                  <div className="stat">
                    <div className="label">P/L</div>
                    <div className={`value ${pnl >= 0 ? "pos" : "neg"}`}>
                      {fmtMoney(pnl)} ({fmtPct(pnlPct)})
                    </div>
                  </div>
                  <div className="stat">
                    <div className="label">Trades</div>
                    <div className="value">{result.trades.length}</div>
                  </div>
                  <div className="stat">
                    <div className="label">Expirations</div>
                    <div className="value">
                      {result.expiredItm}i / {result.expiredOtm}o
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2>Equity curve</h2>
                  <div style={{ height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#25304a"
                        />
                        <XAxis
                          dataKey="date"
                          stroke="#8794b0"
                          tick={{ fontSize: 11 }}
                          minTickGap={40}
                        />
                        <YAxis
                          yAxisId="left"
                          stroke="#4f8cff"
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          stroke="#8794b0"
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#121826",
                            border: "1px solid #25304a",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="equity"
                          stroke="#4f8cff"
                          dot={false}
                          strokeWidth={2}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="spot"
                          stroke="#8794b0"
                          dot={false}
                          strokeWidth={1}
                          strokeDasharray="4 4"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="card">
                  <h2>Trade log ({result.trades.length})</h2>
                  <div className="scroll">
                    <table className="log-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Kind</th>
                          <th>Strike</th>
                          <th>Exp day</th>
                          <th>Contracts</th>
                          <th>Price</th>
                          <th>Cashflow</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t, i) => (
                          <tr key={i}>
                            <td>{t.date}</td>
                            <td>
                              <span className={`tag ${t.kind}`}>{t.kind}</span>
                            </td>
                            <td>{t.strike.toFixed(0)}</td>
                            <td>{t.expiryDayIndex}</td>
                            <td>{t.contracts}</td>
                            <td>{t.price.toFixed(2)}</td>
                            <td
                              style={{
                                color:
                                  t.cashflow >= 0
                                    ? "var(--accent-2)"
                                    : "var(--danger)",
                              }}
                            >
                              {fmtMoney(t.cashflow)}
                            </td>
                            <td>{t.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!result && (
              <div className="card">
                <h2>No run yet</h2>
                <p style={{ color: "var(--muted)" }}>
                  Hit <b>Run backtest</b> to simulate the RSI baseline against
                  the synthetic price series. Train an agent in the other tab
                  to compare.
                </p>
              </div>
            )}
          </>
        )}

        {tab === "train" && (
          <>
            <div className="btn-row">
              <button
                onClick={runTraining}
                disabled={trainingProgress !== null && trainingProgress < 1}
              >
                {trainingProgress !== null && trainingProgress < 1
                  ? "Training…"
                  : "Start training"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setAgent(null);
                  setTrainingLog([]);
                  setTrainingProgress(null);
                }}
                disabled={trainingProgress !== null && trainingProgress < 1}
              >
                Reset agent
              </button>
            </div>

            {trainingProgress !== null && (
              <div className="progress-bar" style={{ marginTop: 14 }}>
                <div style={{ width: `${trainingProgress * 100}%` }} />
              </div>
            )}

            <div className="card" style={{ marginTop: 14 }}>
              <h2>Training log</h2>
              <pre
                style={{
                  maxHeight: 360,
                  overflow: "auto",
                  fontSize: 12,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "var(--text)",
                  background: "var(--panel-2)",
                  padding: 12,
                  borderRadius: 6,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {trainingLog.length === 0
                  ? "No training run yet. Press Start to train a Q-learning agent on the synthetic series above."
                  : trainingLog.join("\n")}
              </pre>
            </div>

            <div className="card">
              <h2>How it works</h2>
              <p style={{ color: "var(--muted)" }}>
                The agent observes three discrete features at each step —
                binned RSI, binned daily return, and whether a call is held —
                and picks from three actions: <b>HOLD</b>, <b>BUY_CALL</b>,{" "}
                <b>SELL</b>. Rewards are the change in mark-to-market portfolio
                equity. Q-values are stored in an in-memory table, so training
                finishes in seconds. Once trained, flip the{" "}
                <em>Use trained agent</em> toggle on the Backtest tab to
                compare against the RSI baseline.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
