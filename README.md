# 💼 Deal or No Deal AU — with Advisor

A Progressive Web App that recreates **Deal or No Deal** in its Australian format
(22 briefcases, 50¢ to $100,000) with a built-in statistical **Advisor** that
recommends which case to open and whether to take the Banker's offer.

This extends the research-agent concept from the Market-Research project — an
app that does the analysis for you — into a live decision co-pilot embedded in
a game: on every Banker call, the Advisor runs thousands of simulations of your
exact board and hands you a verdict, with its working shown.

## Play

It's a fully static site — no build step, no dependencies.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or deploy anywhere static files are served (GitHub Pages works out of the box).
As a PWA it's installable to your home screen and fully playable offline.

## Game mechanics (2024 Australian format)

Modelled on the Network 10 revival hosted by Grant Denyer:

- **22 briefcases** holding 50¢, $1, $2.50, $5, $7.50, $10, $20, $50, $75,
  $100, $250, $500, $750, $1,000, $2,500, $5,000, $7,500, $10,000, $20,000,
  $30,000, $50,000 and **$100,000**.
- You claim one case, then open the rest across nine rounds
  (5 · 4 · 3 · 2 · 2 · 1 · 1 · 1 · 1). After each round the Banker calls.
- **Banker model:** offers are a percentage of the expected value (EV) of the
  remaining board, climbing from ~18% in round one to ~100% at the final call —
  the pattern analyses of broadcast data consistently find (early offers are
  deliberately stingy to keep you playing). A small penalty is applied when the
  board is lopsided, plus a little jitter, and offers are rounded to
  TV-friendly figures.
- **The finale:** decline every offer and you choose to keep or swap your case
  — a classic Australian-version touch.

## The Advisor's algorithm

**Which case to open** — the honest answer, stated in-app: case contents are
placed uniformly at random, so no pick is better than another. The Advisor
still nominates one (to keep the game moving) and quantifies what the round can
do to you: board EV now, EV in the best and worst case after the open, and the
probability of knocking out a $10,000+ value.

**Deal or no deal** — where the maths earns its keep:

1. **Expected value** of the remaining board vs the offer.
2. **Certainty equivalent** under power utility *u(x) = x^ρ*, so risk appetite
   is a dial (Cautious ρ=0.35 · Balanced ρ=0.6 · Bold ρ=1.0) rather than an
   argument. $50,000 guaranteed is genuinely worth more than a coin flip on
   $100,000 to most humans; ρ encodes how much more.
3. **Monte Carlo simulation** — 3,000 continuations of your exact board using
   the Banker's own offer curve, with a myopic stopping rule (bank any future
   offer that clears the risk-adjusted value of what's left). This yields:
   - the risk-adjusted and raw value of saying "no deal",
   - the probability the *next* offer beats this one,
   - the probability your own case beats the offer,
   - the median outcome if you play on.

   Verdict: **DEAL** when the offer beats the simulated risk-adjusted value of
   playing on; confidence scales with the margin.

## Project layout

```
index.html            app shell
styles.css            studio theme
js/game.js            game engine: cases, rounds, banker offer model
js/advisor.js         EV / certainty-equivalent / Monte Carlo advisor
js/ui.js              DOM controller
manifest.webmanifest  PWA manifest
sw.js                 service worker (precache, offline-first)
icons/                generated PNG icons
tools/make-icons.mjs  dependency-free PNG icon generator (node)
```

Player stats (games, winnings, deals taken, deals that beat your case) persist
locally via `localStorage` — nothing leaves your device.

## Research sources

- [Deal or No Deal (Australian game show) — Wikipedia](https://en.wikipedia.org/wiki/Deal_or_No_Deal_(Australian_game_show)) — 2024 revival format: 22 cases, 50¢–$100,000
- [DataGenetics: Deal or No Deal analysis](http://datagenetics.com/blog/january12015/index.html) — offer-as-%-of-EV round curve
- [Communication & Cognition: the Banker's formula](http://commcognition.blogspot.com/2007/06/deal-or-no-deal-bankers-formula.html) — regression fit of broadcast offers
- [Using data to reveal the Banker's strategy](https://www.linkedin.com/pulse/deal-using-data-reveal-bankers-strategy-andrew-kerr) — 83% of offers sit below EV
- [Introduction to Game Theory: Deal or No Deal — Wikibooks](https://en.wikibooks.org/wiki/Introduction_to_Game_Theory/Deal_Or_No_Deal) — EV framing of the deal decision
