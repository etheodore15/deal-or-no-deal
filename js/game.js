/**
 * Deal or No Deal — game engine (Australian 2024 format).
 *
 * 22 briefcases, 50c to $100,000. The player claims one case, then opens
 * the rest across elimination rounds. After each round the Banker calls
 * with an offer. Offers are a percentage of the expected value of the
 * remaining board, climbing from stingy early rounds toward fair value
 * at the end — matching the pattern observed in real broadcast data.
 */

export const CASE_VALUES = [
  0.5, 1, 2.5, 5, 7.5, 10, 20, 50, 75, 100, 250,
  500, 750, 1000, 2500, 5000, 7500, 10000, 20000, 30000, 50000, 100000,
];

// Cases to open in each round before a bank offer. 20 opens total,
// leaving the player's case plus one rival case for the finale.
export const ROUND_SCHEDULE = [5, 4, 3, 2, 2, 1, 1, 1, 1];

// Fraction of expected value the Banker offers after each round.
export const OFFER_CURVE = [0.18, 0.27, 0.38, 0.5, 0.62, 0.73, 0.83, 0.92, 1.0];

export const GamePhase = {
  PICK_OWN: 'pick-own',
  OPENING: 'opening',
  OFFER: 'offer',
  SWAP: 'swap',
  DONE: 'done',
};

export function formatMoney(v) {
  if (v === 0) return '$0';
  if (v < 1) return `${Math.round(v * 100)}¢`;
  const opts = Number.isInteger(v)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return '$' + v.toLocaleString('en-AU', opts);
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function expectedValue(values) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Banker's offer model. Percentage of EV set by the round curve, nudged
 * down slightly when the board is lopsided (high variance means the
 * Banker can afford to lowball), plus a little human jitter, rounded to
 * TV-friendly figures.
 */
export function bankerOffer(remainingValues, roundIndex, rng = Math.random) {
  const ev = expectedValue(remainingValues);
  const base = OFFER_CURVE[Math.min(roundIndex, OFFER_CURVE.length - 1)];
  const mean = ev;
  const sd = Math.sqrt(
    remainingValues.reduce((s, v) => s + (v - mean) ** 2, 0) / remainingValues.length
  );
  const cv = mean > 0 ? sd / mean : 0; // coefficient of variation
  const variancePenalty = Math.min(0.08, cv * 0.03);
  const jitter = (rng() * 2 - 1) * 0.04;
  const pct = Math.max(0.05, base - variancePenalty + jitter);
  return roundOffer(ev * pct);
}

export function roundOffer(x) {
  if (x >= 20000) return Math.round(x / 1000) * 1000;
  if (x >= 5000) return Math.round(x / 500) * 500;
  if (x >= 1000) return Math.round(x / 100) * 100;
  if (x >= 100) return Math.round(x / 10) * 10;
  return Math.max(1, Math.round(x));
}

export class Game {
  constructor(rng = Math.random) {
    this.rng = rng;
    const values = shuffle(CASE_VALUES, rng);
    // cases[i] = { id, value, opened }
    this.cases = values.map((value, i) => ({ id: i + 1, value, opened: false }));
    this.playerCaseId = null;
    this.phase = GamePhase.PICK_OWN;
    this.roundIndex = 0; // index into ROUND_SCHEDULE
    this.opensLeftThisRound = ROUND_SCHEDULE[0];
    this.currentOffer = null;
    this.offerHistory = [];
    this.openedHistory = []; // values in order opened
    this.result = null; // { winnings, playerCaseValue, dealt, dealRound, swapped }
  }

  get playerCase() {
    return this.cases.find((c) => c.id === this.playerCaseId) || null;
  }

  /** Unopened cases excluding the player's own — the ones on the floor. */
  get openableCases() {
    return this.cases.filter((c) => !c.opened && c.id !== this.playerCaseId);
  }

  /** Values still in play (unopened, including the player's case). */
  get remainingValues() {
    return this.cases.filter((c) => !c.opened).map((c) => c.value);
  }

  get expectedValue() {
    return expectedValue(this.remainingValues);
  }

  pickOwnCase(id) {
    if (this.phase !== GamePhase.PICK_OWN) throw new Error('wrong phase');
    this.playerCaseId = id;
    this.phase = GamePhase.OPENING;
  }

  openCase(id) {
    if (this.phase !== GamePhase.OPENING) throw new Error('wrong phase');
    const c = this.cases.find((x) => x.id === id);
    if (!c || c.opened || c.id === this.playerCaseId) throw new Error('bad case');
    c.opened = true;
    this.openedHistory.push(c.value);
    this.opensLeftThisRound--;
    if (this.opensLeftThisRound === 0) {
      this.currentOffer = bankerOffer(this.remainingValues, this.roundIndex, this.rng);
      this.offerHistory.push(this.currentOffer);
      this.phase = GamePhase.OFFER;
    }
    return c;
  }

  acceptOffer() {
    if (this.phase !== GamePhase.OFFER) throw new Error('wrong phase');
    this.result = {
      winnings: this.currentOffer,
      playerCaseValue: this.playerCase.value,
      dealt: true,
      dealRound: this.roundIndex + 1,
      swapped: false,
    };
    this.phase = GamePhase.DONE;
    return this.result;
  }

  declineOffer() {
    if (this.phase !== GamePhase.OFFER) throw new Error('wrong phase');
    this.roundIndex++;
    if (this.roundIndex >= ROUND_SCHEDULE.length) {
      // Two cases left — classic Australian finale: keep or swap.
      this.phase = GamePhase.SWAP;
    } else {
      this.opensLeftThisRound = ROUND_SCHEDULE[this.roundIndex];
      this.phase = GamePhase.OPENING;
    }
  }

  /** Finale: keep own case or swap with the last one standing. */
  finish(swap) {
    if (this.phase !== GamePhase.SWAP) throw new Error('wrong phase');
    const other = this.openableCases[0];
    const kept = swap ? other : this.playerCase;
    this.result = {
      winnings: kept.value,
      playerCaseValue: this.playerCase.value,
      dealt: false,
      dealRound: null,
      swapped: !!swap,
    };
    this.phase = GamePhase.DONE;
    return this.result;
  }
}
