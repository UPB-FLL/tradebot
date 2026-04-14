// Tabular Q-learning agent (TS port of tradebot/agent.py).

import { N_ACTIONS, type State } from "./env";
import { Rng } from "./rng";

export interface AgentOptions {
  gamma?: number;
  alpha?: number;
  epsilon?: number;
  epsilonEnd?: number;
  epsilonDecay?: number;
  seed?: number;
}

export interface SerializedAgent {
  gamma: number;
  alpha: number;
  epsilon: number;
  epsilonEnd: number;
  epsilonDecay: number;
  seed: number;
  q: Record<string, number>;
}

function keyOf(s: State, a: number): string {
  return `${s[0]},${s[1]},${s[2]}|${a}`;
}

export class QAgent {
  gamma: number;
  alpha: number;
  epsilon: number;
  epsilonEnd: number;
  epsilonDecay: number;
  seed: number;
  q: Map<string, number>;
  private rng: Rng;

  constructor(opts: AgentOptions = {}) {
    this.gamma = opts.gamma ?? 0.97;
    this.alpha = opts.alpha ?? 0.1;
    this.epsilon = opts.epsilon ?? 1.0;
    this.epsilonEnd = opts.epsilonEnd ?? 0.05;
    this.epsilonDecay = opts.epsilonDecay ?? 0.995;
    this.seed = opts.seed ?? 42;
    this.q = new Map();
    this.rng = new Rng(this.seed);
  }

  private get(s: State, a: number): number {
    return this.q.get(keyOf(s, a)) ?? 0;
  }

  bestAction(s: State): number {
    let bestA = 0;
    let bestV = -Infinity;
    for (let a = 0; a < N_ACTIONS; a++) {
      const v = this.get(s, a);
      if (v > bestV) {
        bestV = v;
        bestA = a;
      }
    }
    return bestA;
  }

  act(s: State, explore: boolean): number {
    if (explore && this.rng.next() < this.epsilon) {
      return this.rng.nextInt(N_ACTIONS);
    }
    return this.bestAction(s);
  }

  update(s: State, a: number, r: number, sNext: State, done: boolean): void {
    const current = this.get(s, a);
    let target = r;
    if (!done) {
      let bestNext = -Infinity;
      for (let a2 = 0; a2 < N_ACTIONS; a2++) {
        const v = this.get(sNext, a2);
        if (v > bestNext) bestNext = v;
      }
      target = r + this.gamma * bestNext;
    }
    this.q.set(keyOf(s, a), current + this.alpha * (target - current));
  }

  decayEpsilon(): void {
    this.epsilon = Math.max(this.epsilonEnd, this.epsilon * this.epsilonDecay);
  }

  toJSON(): SerializedAgent {
    const q: Record<string, number> = {};
    this.q.forEach((v, k) => {
      q[k] = v;
    });
    return {
      gamma: this.gamma,
      alpha: this.alpha,
      epsilon: this.epsilon,
      epsilonEnd: this.epsilonEnd,
      epsilonDecay: this.epsilonDecay,
      seed: this.seed,
      q,
    };
  }

  static fromJSON(data: SerializedAgent): QAgent {
    const a = new QAgent({
      gamma: data.gamma,
      alpha: data.alpha,
      epsilon: data.epsilon,
      epsilonEnd: data.epsilonEnd,
      epsilonDecay: data.epsilonDecay,
      seed: data.seed,
    });
    for (const [k, v] of Object.entries(data.q)) a.q.set(k, v);
    return a;
  }
}
