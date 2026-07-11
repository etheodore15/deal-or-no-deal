/**
 * The Advisor — a statistical co-pilot for Deal or No Deal.
 *
 * Two jobs:
 *
 * 1. Which case to open next. Contents are placed uniformly at random,
 *    so no pick changes your odds — the Advisor says so honestly, then
 *    nominates one anyway (decision paralysis is real) and quantifies
 *    the best/worst-case swing this round will put on the board.
 *
 * 2. Deal or no deal. This is where the maths earns its keep:
 *    - Expected value (EV) of the remaining board vs the offer.
 *    - A certainty equivalent (CE) under power utility u(x) = x^rho,
 *      so risk appetite is a dial rather than an argument.
 *    - Monte Carlo simulation of playing on, using the same offer curve
 *      the Banker uses, with a myopic-CE stopping policy at future
 *      offers. Yields P(a better offer is coming), P(beating the offer
 *      by refusing every deal), and the risk-adjusted value of "no deal".
 */

import {
  ROUND_SCHEDULE,
  bankerOffer,
  expectedValue,
  shuffle,
} from './game.js';

export const RISK_PROFILES = {
  cautious: { rho: 0.35, label: 'Cautious' },
  balanced: { rho: 0.6, label: 'Balanced' },
  bold: { rho: 1.0, label: 'Bold' },
};

/** Certainty equivalent of a uniform gamble over `values` under u(x)=x^rho. */
export function certaintyEquivalent(values, rho) {
  if (rho >= 0.999) return expectedValue(values);
  const eu = values.reduce((s, v) => s + Math.pow(v, rho), 0) / values.length;
  return Math.pow(eu, 1 / rho);
}

/**
 * Recommend a case to open. Statistically a coin toss — the value is in
 * the framing, not the pick.
 */
export function recommendCase(game) {
  const candidates = game.openableCases;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const remaining = game.remainingValues.slice().sort((a, b) => a - b);
  const n = remaining.length;
  const sum = remaining.reduce((s, v) => s + v, 0);
  // EV of the board if this open removes the lowest / highest value left.
  const bestCaseEV = (sum - remaining[0]) / (n - 1);
  const worstCaseEV = (sum - remaining[n - 1]) / (n - 1);
  const bigValues = remaining.filter((v) => v >= 10000).length;
  return {
    caseId: pick.id,
    evNow: sum / n,
    bestCaseEV,
    worstCaseEV,
    pBigHit: bigValues / n, // chance this open knocks out a $10k+ value
  };
}

/**
 * Simulate playing on from the current offer to estimate what "no deal"
 * is actually worth. From the Advisor's seat the player's case is just
 * another unknown, so every simulation deals the remaining values out
 * uniformly.
 */
export function simulateContinue(game, rho, sims = 3000, rng = Math.random) {
  const remaining = game.remainingValues;
  const roundIndex = game.roundIndex;
  const offer = game.currentOffer;

  let acceptedLater = 0;
  let nextOfferBetter = 0;
  let finalBeatsOffer = 0;
  let sumWinnings = 0;
  let sumUtility = 0;
  let sumFinalCase = 0;
  const winnings = new Array(sims);

  for (let s = 0; s < sims; s++) {
    const order = shuffle(remaining, rng);
    // order[0] plays the part of the player's case; the rest open in order.
    let opened = 0;
    let payout = null;
    let firstFuture = true;

    for (let r = roundIndex + 1; r < ROUND_SCHEDULE.length; r++) {
      opened += ROUND_SCHEDULE[r];
      const live = [order[0], ...order.slice(1 + opened)];
      const futureOffer = bankerOffer(live, r, rng);
      if (firstFuture) {
        if (futureOffer > offer) nextOfferBetter++;
        firstFuture = false;
      }
      // Myopic stopping rule: bank the offer once it clears the
      // risk-adjusted value of what's left.
      if (futureOffer >= certaintyEquivalent(live, rho)) {
        payout = futureOffer;
        acceptedLater++;
        break;
      }
    }
    if (payout === null) payout = order[0]; // rode it to the end
    if (order[0] > offer) finalBeatsOffer++;
    sumFinalCase += order[0];
    sumWinnings += payout;
    sumUtility += Math.pow(payout, rho);
    winnings[s] = payout;
  }

  winnings.sort((a, b) => a - b);
  return {
    evContinue: sumWinnings / sims,
    ceContinue: Math.pow(sumUtility / sims, 1 / rho),
    pNextOfferBetter: nextOfferBetter / sims,
    pFinalCaseBeatsOffer: finalBeatsOffer / sims,
    pAcceptLater: acceptedLater / sims,
    medianContinue: winnings[Math.floor(sims / 2)],
    evFinalCase: sumFinalCase / sims,
  };
}

/**
 * Full deal/no-deal verdict for the current offer.
 */
export function adviseOnOffer(game, riskKey = 'balanced', sims = 3000) {
  const { rho } = RISK_PROFILES[riskKey] || RISK_PROFILES.balanced;
  const offer = game.currentOffer;
  const remaining = game.remainingValues;
  const ev = expectedValue(remaining);
  const ceBoard = certaintyEquivalent(remaining, rho);
  const sim = simulateContinue(game, rho, sims);

  // Compare the sure thing against the simulated risk-adjusted value of
  // playing on. The margin drives the confidence readout.
  const dealValue = offer;
  const noDealValue = sim.ceContinue;
  const deal = dealValue >= noDealValue;
  const margin = Math.abs(dealValue - noDealValue) / Math.max(dealValue, noDealValue, 1);
  const confidence = Math.round(Math.min(0.99, 0.5 + margin * 1.8) * 100);

  return {
    verdict: deal ? 'DEAL' : 'NO DEAL',
    confidence,
    offer,
    ev,
    offerPctOfEV: offer / ev,
    ceBoard,
    rho,
    ...sim,
  };
}
