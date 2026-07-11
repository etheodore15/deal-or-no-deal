/**
 * UI controller — wires the game engine and the Advisor to the DOM.
 */

import { Game, GamePhase, CASE_VALUES, ROUND_SCHEDULE, formatMoney } from './game.js';
import { recommendCase, adviseOnOffer, RISK_PROFILES } from './advisor.js';

const $ = (id) => document.getElementById(id);

const els = {
  board: { low: $('board-low'), high: $('board-high'), ev: $('board-ev-value') },
  message: $('message'),
  caseGrid: $('case-grid'),
  playerSlot: $('player-case-slot'),
  playerCase: $('player-case'),
  roundIndicator: $('round-indicator'),
  advisorBody: $('advisor-body'),
  riskToggle: $('risk-toggle'),
  offerHistory: $('offer-history'),
  offerHistoryList: $('offer-history-list'),
  offerModal: $('offer-modal'),
  offerAmount: $('offer-amount'),
  offerAdvice: $('offer-advice'),
  offerDetails: $('offer-details'),
  revealModal: $('reveal-modal'),
  revealLabel: $('reveal-case-label'),
  revealAmount: $('reveal-amount'),
  swapModal: $('swap-modal'),
  swapText: $('swap-text'),
  endModal: $('end-modal'),
  endTitle: $('end-title'),
  endAmount: $('end-amount'),
  endSummary: $('end-summary'),
  statsModal: $('stats-modal'),
  statsBody: $('stats-body'),
};

const MEDIAN_VALUE = CASE_VALUES.slice().sort((a, b) => a - b)[Math.floor(CASE_VALUES.length / 2)];

let game;
let riskKey = 'balanced';
let caseAdvice = null; // last recommendCase() result
let offerAdvice = null; // last adviseOnOffer() result

/* ---------- Persistence ---------- */

const STATS_KEY = 'dond-stats-v1';

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || { games: [] };
  } catch {
    return { games: [] };
  }
}

function saveGameResult(result) {
  const stats = loadStats();
  stats.games.push({
    winnings: result.winnings,
    caseValue: result.playerCaseValue,
    dealt: result.dealt,
    bestOffer: result.bestOffer,
    followedAdvisor: result.followedAdvisor,
    when: Date.now(),
  });
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

/**
 * Who won the game? If you dealt, you beat the Banker when the offer you
 * took exceeds what your case held. If you refused every deal, you beat
 * the Banker when your winnings match or top the best offer you knocked
 * back — otherwise the Banker's lowballing paid off.
 */
function playerWonGame(g) {
  return g.dealt ? g.winnings > g.caseValue : g.winnings >= (g.bestOffer || 0);
}

function tallyScore(games) {
  const score = { youWins: 0, youTotal: 0, bankWins: 0, bankTotal: 0 };
  for (const g of games) {
    if (playerWonGame(g)) {
      score.youWins++;
      score.youTotal += g.winnings;
    } else {
      score.bankWins++;
      score.bankTotal += g.winnings;
    }
  }
  return score;
}

function renderScoreboard() {
  const el = $('scoreboard');
  const { games } = loadStats();
  if (games.length === 0) {
    el.textContent = '';
    el.hidden = true;
    return;
  }
  const s = tallyScore(games);
  el.hidden = false;
  el.innerHTML =
    `<span class="you">You ${s.youWins}</span> <span class="amt">(${formatMoney(s.youTotal)})</span>` +
    ` · <span class="bank">Bank ${s.bankWins}</span> <span class="amt">(${formatMoney(s.bankTotal)})</span>`;
}

/* ---------- Rendering ---------- */

const pct = (x) => `${Math.round(x * 100)}%`;

function renderBoard() {
  const sorted = CASE_VALUES.slice().sort((a, b) => a - b);
  const half = sorted.length / 2;
  const remaining = new Set(game.remainingValues);
  for (const [el, vals] of [
    [els.board.low, sorted.slice(0, half)],
    [els.board.high, sorted.slice(half)],
  ]) {
    el.innerHTML = '';
    for (const v of vals) {
      const li = document.createElement('li');
      li.textContent = formatMoney(v);
      li.dataset.value = v;
      if (!remaining.has(v)) li.classList.add('gone');
      el.appendChild(li);
    }
  }
  els.board.ev.textContent = formatMoney(Math.round(game.expectedValue));
}

function flashBoardValue(value) {
  const li = document.querySelector(`.board-col li[data-value="${value}"]`);
  if (li) {
    li.classList.add('gone', 'just-gone');
  }
  els.board.ev.textContent = formatMoney(Math.round(game.expectedValue));
}

function renderCases() {
  els.caseGrid.innerHTML = '';
  const picking = game.phase === GamePhase.PICK_OWN;
  for (const c of game.cases) {
    if (c.id === game.playerCaseId) continue;
    const btn = document.createElement('button');
    btn.className = 'case';
    btn.dataset.id = c.id;
    if (c.opened) {
      btn.classList.add('opened');
      btn.textContent = formatMoney(c.value);
      btn.disabled = true;
    } else {
      btn.textContent = c.id;
      btn.disabled = !(picking || game.phase === GamePhase.OPENING);
      if (caseAdvice && caseAdvice.caseId === c.id && game.phase === GamePhase.OPENING) {
        btn.classList.add('recommended');
        btn.title = 'Advisor’s pick';
      }
      btn.addEventListener('click', () => onCaseClick(c.id));
    }
    els.caseGrid.appendChild(btn);
  }
  if (game.playerCaseId) {
    els.playerSlot.hidden = false;
    els.playerCase.textContent = game.playerCaseId;
  } else {
    els.playerSlot.hidden = true;
  }
}

function renderRoundIndicator() {
  if (game.phase === GamePhase.PICK_OWN) {
    els.roundIndicator.textContent = 'Pick your case';
  } else if (game.phase === GamePhase.DONE) {
    els.roundIndicator.textContent = 'Game over';
  } else if (game.phase === GamePhase.SWAP) {
    els.roundIndicator.textContent = 'The finale';
  } else {
    els.roundIndicator.textContent = `Round ${game.roundIndex + 1} of ${ROUND_SCHEDULE.length}`;
  }
}

function renderMessage() {
  let text;
  switch (game.phase) {
    case GamePhase.PICK_OWN:
      text = 'Welcome! Choose the case you’ll defend for the rest of the game.';
      break;
    case GamePhase.OPENING: {
      const n = game.opensLeftThisRound;
      text = `Round ${game.roundIndex + 1}: open ${n} more case${n === 1 ? '' : 's'}, then the Banker will call.`;
      break;
    }
    case GamePhase.OFFER:
      text = 'The Banker is on the phone…';
      break;
    case GamePhase.SWAP:
      text = 'Two cases remain. Keep yours, or swap?';
      break;
    default:
      text = 'Game over — hit “New game” to go again.';
  }
  els.message.textContent = text;
}

function renderOfferHistory(takenIndex = -1) {
  if (game.offerHistory.length === 0) {
    els.offerHistory.hidden = true;
    return;
  }
  els.offerHistory.hidden = false;
  els.offerHistoryList.innerHTML = '';
  game.offerHistory.forEach((o, i) => {
    const li = document.createElement('li');
    li.textContent = formatMoney(o);
    li.classList.add(i === takenIndex ? 'taken' : 'declined');
    els.offerHistoryList.appendChild(li);
  });
}

/* ---------- Advisor panel ---------- */

function statItem(k, v, cls = '') {
  return `<li><span class="k">${k}</span><span class="v ${cls}">${v}</span></li>`;
}

function renderAdvisorForPicking() {
  els.advisorBody.innerHTML = `
    <p class="advice-verdict">Grab any case — they’re all the same 1-in-22 shot.</p>
    <p class="advice-note">The values were shuffled before you walked in, so your pick can’t be
    “lucky” or “unlucky” yet. Superstition is free, though.</p>`;
}

function renderAdvisorForOpening() {
  caseAdvice = recommendCase(game);
  const a = caseAdvice;
  els.advisorBody.innerHTML = `
    <p class="advice-verdict">Open <span class="pick">case ${a.caseId}</span> ★</p>
    <ul class="stat-list">
      ${statItem('Board EV now', formatMoney(Math.round(a.evNow)))}
      ${statItem('Best case after open', formatMoney(Math.round(a.bestCaseEV)), 'good')}
      ${statItem('Worst case after open', formatMoney(Math.round(a.worstCaseEV)), 'bad')}
      ${statItem('Chance of losing a $10k+ value', pct(a.pBigHit), a.pBigHit > 0.4 ? 'bad' : '')}
    </ul>
    <p class="advice-note">Full disclosure: every unopened case is statistically identical, so my
    pick is just a nudge to keep you moving. What matters is the numbers above — they tell you how
    rough this round could get before the Banker calls.</p>`;
  renderCases();
}

function verdictColor(verdict) {
  return verdict === 'DEAL' ? 'verdict-deal' : 'verdict-no-deal';
}

function renderAdvisorForOffer() {
  offerAdvice = adviseOnOffer(game, riskKey);
  const a = offerAdvice;
  const summary = `
    <p class="advice-verdict">My call: <span class="${verdictColor(a.verdict)}">${a.verdict}</span>
      (${a.confidence}% confident, ${RISK_PROFILES[riskKey].label.toLowerCase()} profile)</p>`;
  const stats = `
    <ul class="stat-list">
      ${statItem('Banker’s offer', formatMoney(a.offer))}
      ${statItem('Board EV', formatMoney(Math.round(a.ev)))}
      ${statItem('Offer as % of EV', pct(a.offerPctOfEV), a.offerPctOfEV >= 1 ? 'good' : '')}
      ${statItem('Risk-adjusted value of the board', formatMoney(Math.round(a.ceBoard)))}
      ${statItem(`Deal threshold (${RISK_PROFILES[riskKey].label.toLowerCase()})`, `≥ ${formatMoney(Math.round(a.ceContinue))}`, a.ceContinue > a.offer ? 'good' : 'bad')}
      ${statItem('Playing on is worth (raw EV)', formatMoney(Math.round(a.evContinue)))}
      ${statItem('Chance next offer beats this', pct(a.pNextOfferBetter), a.pNextOfferBetter >= 0.5 ? 'good' : 'bad')}
      ${statItem('Chance your case beats this offer', pct(a.pFinalCaseBeatsOffer))}
      ${statItem('Median outcome if you play on', formatMoney(Math.round(a.medianContinue)))}
    </ul>
    <p class="advice-note">Based on 3,000 simulated continuations of this exact board, using the
    Banker’s own offer curve. “Risk-adjusted” weighs outcomes by how much a dollar is actually
    worth to a ${RISK_PROFILES[riskKey].label.toLowerCase()} player (utility x<sup>${a.rho}</sup>).</p>`;

  els.advisorBody.innerHTML = summary + stats;

  // Mirror the verdict into the offer modal.
  els.offerAdvice.innerHTML = `🎓 Advisor (${RISK_PROFILES[riskKey].label.toLowerCase()}) says
    <span class="${verdictColor(a.verdict)}">${a.verdict}</span> —
    ${a.verdict === 'DEAL'
      ? `this offer beats the risk-adjusted ${formatMoney(Math.round(a.ceContinue))} you’d expect from playing on.`
      : `playing on is worth ~${formatMoney(Math.round(a.ceContinue))} risk-adjusted, and there’s a ${pct(a.pNextOfferBetter)} chance the next offer is higher.`}`;
  els.offerDetails.innerHTML = stats;
}

/* ---------- Modals ---------- */

function showReveal(c, then) {
  els.revealLabel.textContent = `Case ${c.id}`;
  els.revealAmount.textContent = formatMoney(c.value);
  els.revealAmount.className = 'reveal-amount ' + (c.value >= MEDIAN_VALUE ? 'high' : 'low');
  els.revealModal.hidden = false;
  setTimeout(() => {
    els.revealModal.hidden = true;
    then?.();
  }, 1400);
}

function showOfferModal() {
  els.offerAmount.textContent = formatMoney(game.currentOffer);
  els.offerDetails.hidden = true;
  $('btn-offer-details').textContent = 'Show the Advisor’s working ▾';
  els.offerModal.hidden = false;
}

function endGame(result, followedAdvisor) {
  result.followedAdvisor = followedAdvisor;
  result.bestOffer = Math.max(...game.offerHistory, 0);
  saveGameResult(result);

  const { winnings, playerCaseValue, dealt, swapped } = result;
  els.endTitle.textContent = dealt ? 'DEAL! 🤝' : swapped ? 'You swapped! 💼' : 'You held your nerve! 💼';
  els.endAmount.textContent = formatMoney(winnings);

  const lines = [];
  if (dealt) {
    lines.push(`Your case ${game.playerCaseId} contained <strong>${formatMoney(playerCaseValue)}</strong>.`);
    lines.push(
      winnings > playerCaseValue
        ? `✅ Great deal — you beat your case by <strong>${formatMoney(winnings - playerCaseValue)}</strong>.`
        : `❌ The Banker got you — your case was worth <strong>${formatMoney(playerCaseValue - winnings)}</strong> more.`
    );
  } else {
    const other = game.openableCases[0];
    lines.push(`The other case held <strong>${formatMoney(other.value)}</strong>.`);
    if (swapped) {
      lines.push(playerCaseValue > winnings
        ? `Your original case had <strong>${formatMoney(playerCaseValue)}</strong> — the swap cost you.`
        : `Your original case had <strong>${formatMoney(playerCaseValue)}</strong> — good swap!`);
    }
    if (result.bestOffer > winnings) {
      lines.push(`The best offer you turned down was <strong>${formatMoney(result.bestOffer)}</strong>.`);
    } else {
      lines.push(`You beat every offer the Banker made. 🎉`);
    }
  }

  const youWon = playerWonGame({
    winnings,
    caseValue: playerCaseValue,
    dealt,
    bestOffer: result.bestOffer,
  });
  const s = tallyScore(loadStats().games);
  lines.push(
    (youWon ? '🏆 <strong>This one goes to you.</strong>' : '🏦 <strong>This one goes to the Banker.</strong>') +
    ` Running tally: you ${s.youWins} (${formatMoney(s.youTotal)}) — Bank ${s.bankWins} (${formatMoney(s.bankTotal)}).`
  );

  els.endSummary.innerHTML = `<p>${lines.join('</p><p>')}</p>`;
  els.endModal.hidden = false;

  renderScoreboard();
  renderAll();
}

/* ---------- Event flow ---------- */

function onCaseClick(id) {
  if (game.phase === GamePhase.PICK_OWN) {
    game.pickOwnCase(id);
    renderAll();
    renderAdvisorForOpening();
    return;
  }
  if (game.phase !== GamePhase.OPENING) return;
  const c = game.openCase(id);
  renderCases();
  flashBoardValue(c.value);
  showReveal(c, () => {
    renderAll();
    if (game.phase === GamePhase.OFFER) {
      renderAdvisorForOffer();
      renderOfferHistory();
      showOfferModal();
    } else {
      renderAdvisorForOpening();
    }
  });
}

function onDeal() {
  els.offerModal.hidden = true;
  const followed = offerAdvice?.verdict === 'DEAL';
  const takenIndex = game.offerHistory.length - 1;
  const result = game.acceptOffer();
  renderOfferHistory(takenIndex);
  endGame(result, followed);
}

function onNoDeal() {
  els.offerModal.hidden = true;
  game.declineOffer();
  if (game.phase === GamePhase.SWAP) {
    const other = game.openableCases[0];
    els.swapText.textContent =
      `Case ${game.playerCaseId} (yours) and case ${other.id} are all that’s left. ` +
      `One holds ${formatMoney(Math.min(...game.remainingValues))}, the other ${formatMoney(Math.max(...game.remainingValues))}.`;
    els.swapModal.hidden = false;
    renderAll();
  } else {
    renderAll();
    renderAdvisorForOpening();
  }
}

function onFinish(swap) {
  els.swapModal.hidden = true;
  const result = game.finish(swap);
  endGame(result, true); // swap/keep are equal-odds; no advice to defy
}

function renderAll() {
  renderBoard();
  renderCases();
  renderMessage();
  renderRoundIndicator();
}

function newGame() {
  game = new Game();
  caseAdvice = null;
  offerAdvice = null;
  els.endModal.hidden = true;
  els.offerModal.hidden = true;
  els.swapModal.hidden = true;
  renderAll();
  renderOfferHistory();
  renderAdvisorForPicking();
  renderScoreboard();
}

/* ---------- Stats ---------- */

function showStats() {
  const { games } = loadStats();
  if (games.length === 0) {
    els.statsBody.innerHTML = '<p>No completed games yet. Go make the Banker sweat.</p>';
  } else {
    const total = games.reduce((s, g) => s + g.winnings, 0);
    const best = Math.max(...games.map((g) => g.winnings));
    const deals = games.filter((g) => g.dealt).length;
    const beatCase = games.filter((g) => g.dealt && g.winnings > g.caseValue).length;
    const s = tallyScore(games);
    els.statsBody.innerHTML = `
      <ul class="stat-list">
        ${statItem('You beat the Banker', `${s.youWins} game${s.youWins === 1 ? '' : 's'}`, 'good')}
        ${statItem('…banking a total of', formatMoney(s.youTotal), 'good')}
        ${statItem('The Banker beat you', `${s.bankWins} game${s.bankWins === 1 ? '' : 's'}`, s.bankWins ? 'bad' : '')}
        ${statItem('…where you only banked', formatMoney(s.bankTotal), s.bankWins ? 'bad' : '')}
        ${statItem('Games played', games.length)}
        ${statItem('Total winnings', formatMoney(total))}
        ${statItem('Average winnings', formatMoney(Math.round(total / games.length)))}
        ${statItem('Best game', formatMoney(best))}
        ${statItem('Deals taken', `${deals} of ${games.length}`)}
        ${statItem('Deals that beat your case', deals ? `${beatCase} of ${deals}` : '—')}
      </ul>
      <p class="advice-note">A game goes to you when your deal beat your case’s contents, or —
      having refused every offer — your case matched or beat the best offer you turned down.</p>`;
  }
  els.statsModal.hidden = false;
}

/* ---------- Wire up ---------- */

$('btn-deal').addEventListener('click', onDeal);
$('btn-no-deal').addEventListener('click', onNoDeal);
$('btn-keep').addEventListener('click', () => onFinish(false));
$('btn-swap').addEventListener('click', () => onFinish(true));
$('btn-play-again').addEventListener('click', newGame);
$('btn-new-game').addEventListener('click', newGame);
$('btn-stats').addEventListener('click', showStats);
$('btn-close-stats').addEventListener('click', () => (els.statsModal.hidden = true));

$('btn-offer-details').addEventListener('click', (e) => {
  const open = els.offerDetails.hidden;
  els.offerDetails.hidden = !open;
  e.target.textContent = open ? 'Hide the Advisor’s working ▴' : 'Show the Advisor’s working ▾';
});

function setRisk(key) {
  riskKey = key;
  // Keep both toggles (side panel + offer modal) in sync.
  for (const group of [els.riskToggle, $('offer-risk-toggle')]) {
    for (const b of group.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.risk === key);
    }
  }
  // Re-run whichever advice is on screen with the new risk profile.
  if (game.phase === GamePhase.OFFER) renderAdvisorForOffer();
  else if (game.phase === GamePhase.OPENING) renderAdvisorForOpening();
}

for (const group of [els.riskToggle, $('offer-risk-toggle')]) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-risk]');
    if (btn) setRisk(btn.dataset.risk);
  });
}

/* ---------- PWA install prompt ---------- */

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('btn-install').hidden = true;
});

newGame();
