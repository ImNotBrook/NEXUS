import "./style.css";
import { mountWorkspaceLayout } from "./ui/workspace-layout";
import { mountResearchConsole } from "./domain/research-console";
import { mountSkillConsole } from "./domain/skill-console";
import { mountAutomationConsole } from "./ui/automation-console";
import { evaluateQualification } from "./domain/qualification";
import { rsi } from "./domain/indicators";
import { fetchBinanceCandles, type BinanceInterval } from "./adapters/binance-public";
import { fetchKrakenCandles } from "./adapters/kraken-public";
import { IndexedDbMarketSnapshotCache } from "./adapters/market-snapshot-cache";
import type { MarketDataProvider } from "./domain/market-data";
import { loadMarketIntelligence } from "./domain/market-intelligence-service";
import { buildMarketIntelligencePresentation, type MarketIntelligencePresentation } from "./domain/market-intelligence-presentation";
import type { MarketRegimeConfig } from "./domain/market-regimes";
import { PaperAccountStore } from "./adapters/paper-account-store";
import {
  createPaperAccount, executePaperMarketOrder, getPaperAccountSummary, markPaperAccount,
  type PaperAccount,
} from "./domain/paper-broker";

const result = evaluateQualification({ qualifyingDays: 0, completedTrades: 0 });
const MARKET_REGIME_CONFIG: MarketRegimeConfig = {
  fastEmaPeriod: 5,
  slowEmaPeriod: 13,
  atrPeriod: 14,
  trendThresholdPct: 0.1,
  lowVolatilityAtrPct: 0.3,
  highVolatilityAtrPct: 1.5,
};
const root = document.querySelector<HTMLDivElement>("#root");

if (!root) throw new Error("Root element #root was not found");

root.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">N</span><span>NEXUS</span></div>
      <span class="status"><i></i> RESEARCH MODE</span>
    </header>
    <section class="hero">
      <p class="eyebrow">TRADING INTELLIGENCE SYSTEM</p>
      <h1>Decisions backed<br/><span>by evidence.</span></h1>
      <p class="intro">A research-first environment for crypto markets, strategy validation and disciplined paper trading.</p>
      <div class="account">
        <div><span class="muted">SIMULATED EQUITY</span><strong id="paper-equity">— <small>USDT</small></strong></div>
        <span class="paper-pill">PAPER ACCOUNT</span>
      </div>
    </section>
    <section class="grid">
      <article class="panel market-panel">
        <span class="panel-label">MARKET INTELLIGENCE</span>
        <div class="market-heading"><h2>BTC / USDT</h2><span class="tag safe">PUBLIC DATA</span></div>
        <strong class="market-value" id="btc-price">—</strong>
        <p id="btc-change" class="market-change">Waiting for market data</p>
        <p id="market-quality" class="small" role="status">Data quality not checked</p>
        <div class="market-metrics"><span>RSI (14)</span><strong id="btc-rsi">—</strong></div>
        <div class="market-footer"><span id="market-updated">No snapshot loaded</span><button id="refresh-market" class="refresh-button" type="button">Refresh</button></div>
      </article>
      <article class="panel intelligence-panel">
        <span class="panel-label">MULTI-TIMEFRAME CONTEXT · NON-PREDICTIVE</span>
        <div class="market-heading"><h2 id="market-phase">UNKNOWN</h2><span id="intelligence-quality" class="tag">NOT CHECKED</span></div>
        <p id="market-phase-rationale" class="small">Waiting for four-timeframe market context</p>
        <div class="intelligence-grid">
          <span>1D macro<strong id="market-macro">UNKNOWN</strong></span>
          <span>4H primary<strong id="market-primary">UNKNOWN</strong></span>
          <span>1H tactical<strong id="market-tactical">UNKNOWN</strong></span>
          <span>15M micro<strong id="market-micro">UNKNOWN</strong></span>
          <span>Volatility<strong id="market-volatility">UNKNOWN</strong></span>
          <span>Alignment<strong id="market-alignment">UNKNOWN</strong></span>
          <span>Uncertainty<strong id="market-uncertainty">UNKNOWN</strong></span>
          <span>Coverage<strong id="market-coverage">0 / 4 timeframes</strong></span>
        </div>
        <p id="market-divergence" class="small">No lower-timeframe assessment</p>
        <p id="market-crossfeed" class="small">Cross-feed unavailable</p>
        <p id="market-liquidity" class="small">Liquidity: unknown</p>
        <p id="market-positioning" class="small">Positioning: unknown</p>
        <p id="market-missing" class="small">Missing dimensions not checked</p>
        <p id="market-paper-gate" class="paper-status" role="status">LOCKED · DATA NOT TRUSTED</p>
      </article>
      <article class="panel paper-panel">
        <span class="panel-label">PAPER EXECUTION</span>
        <h2>Simulated order desk</h2>
        <p>BTC/USDT spot only · 0.10% fee · 0.10% adverse slippage · no leverage</p>
        <div class="paper-controls">
          <label for="paper-quantity">BTC quantity</label>
          <input id="paper-quantity" type="number" inputmode="decimal" min="0.000001" step="0.000001" value="0.001" />
          <div class="paper-buttons">
            <button id="paper-buy" type="button" disabled>Paper buy</button>
            <button id="paper-sell" type="button" disabled>Paper sell</button>
          </div>
        </div>
        <div class="paper-stats">
          <span>Available cash<strong id="paper-cash">—</strong></span>
          <span>Realised P&L<strong id="paper-realized">—</strong></span>
          <span>Open BTC<strong id="paper-position">0</strong></span>
        </div>
        <p id="paper-status" class="paper-status" role="status">Opening local paper account…</p>
        <div id="paper-fills" class="paper-fills">No paper fills yet</div>
      </article>
      <article class="panel"><span class="panel-label">STRATEGY LAB</span><h2>Qualification gate</h2><p>90 qualifying days and 1,000 completed trades are both mandatory.</p><div class="progress"><span style="width:0%"></span></div><p class="small">0 / 90 days · 0 / 1,000 trades</p></article>
      <article class="panel"><span class="panel-label">EXECUTION CONTROL</span><h2>Live trading disabled</h2><p>Qualification can request human review. It cannot grant execution permission.</p><span class="tag safe">LIVE EXECUTION LOCKED</span></article>
      <article class="panel"><span class="panel-label">SYSTEM STATUS</span><h2>Core safeguards</h2><ul><li>Paper trading only</li><li>AI changes require approval</li><li>Backtest integrity enforced</li></ul></article>
    </section>
    <div id="research-console-mount"></div>
    <div id="skill-console-mount"></div>
    <div id="automation-console-mount"></div>
    <footer> NEXUS v0.1.0 <span>BUILDING THE EVIDENCE ENGINE</span></footer>
  </main>
`;

document.documentElement.dataset.qualificationReady = String(!result.qualified);
const researchConsoleMount = document.querySelector<HTMLElement>("#research-console-mount");
if (researchConsoleMount) mountResearchConsole(researchConsoleMount);
const skillConsoleMount = document.querySelector<HTMLElement>("#skill-console-mount");
if (skillConsoleMount) mountSkillConsole(skillConsoleMount);
const automationConsoleMount = document.querySelector<HTMLElement>("#automation-console-mount");
if (automationConsoleMount) mountAutomationConsole(automationConsoleMount);
mountWorkspaceLayout(root);

const priceElement = document.querySelector<HTMLElement>("#btc-price");
const changeElement = document.querySelector<HTMLElement>("#btc-change");
const rsiElement = document.querySelector<HTMLElement>("#btc-rsi");
const updatedElement = document.querySelector<HTMLElement>("#market-updated");
const qualityElement = document.querySelector<HTMLElement>("#market-quality");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-market");
const paperEquityElement = document.querySelector<HTMLElement>("#paper-equity");
const paperCashElement = document.querySelector<HTMLElement>("#paper-cash");
const paperRealizedElement = document.querySelector<HTMLElement>("#paper-realized");
const paperPositionElement = document.querySelector<HTMLElement>("#paper-position");
const paperStatusElement = document.querySelector<HTMLElement>("#paper-status");
const paperFillsElement = document.querySelector<HTMLElement>("#paper-fills");
const paperQuantityInput = document.querySelector<HTMLInputElement>("#paper-quantity");
const paperBuyButton = document.querySelector<HTMLButtonElement>("#paper-buy");
const paperSellButton = document.querySelector<HTMLButtonElement>("#paper-sell");
const intelligenceElements: Array<[keyof MarketIntelligencePresentation, HTMLElement | null]> = [
  ["phase", document.querySelector("#market-phase")],
  ["phaseRationale", document.querySelector("#market-phase-rationale")],
  ["macroTrend", document.querySelector("#market-macro")],
  ["primaryTrend", document.querySelector("#market-primary")],
  ["tacticalTrend", document.querySelector("#market-tactical")],
  ["microTrend", document.querySelector("#market-micro")],
  ["volatility", document.querySelector("#market-volatility")],
  ["alignment", document.querySelector("#market-alignment")],
  ["uncertainty", document.querySelector("#market-uncertainty")],
  ["lowerTimeframeDivergence", document.querySelector("#market-divergence")],
  ["coverage", document.querySelector("#market-coverage")],
  ["quality", document.querySelector("#intelligence-quality")],
  ["crossFeed", document.querySelector("#market-crossfeed")],
  ["liquidity", document.querySelector("#market-liquidity")],
  ["positioning", document.querySelector("#market-positioning")],
  ["missingDimensions", document.querySelector("#market-missing")],
  ["paperEligibility", document.querySelector("#market-paper-gate")],
];
const paperStore = new PaperAccountStore();
const marketCache = new IndexedDbMarketSnapshotCache();
const marketProviders: MarketDataProvider[] = [
  {
    name: "Binance public spot",
    fetchCandles: ({ symbol, interval, limit }) =>
      fetchBinanceCandles({ symbol, interval: interval as BinanceInterval, limit }),
  },
  {
    name: "Kraken public spot",
    fetchCandles: ({ symbol, interval }) =>
      fetchKrakenCandles({ symbol, interval: interval as "1h" }),
  },
];
let paperAccount: PaperAccount | null = null;
let latestBtcPrice: number | null = null;
let latestBtcFetchedAt: number | null = null;
let marketDataTrusted = false;
let paperOrderInFlight = false;

function renderPaperAccount(): void {
  if (!paperAccount) return;
  const summary = getPaperAccountSummary(paperAccount);
  if (paperEquityElement) paperEquityElement.textContent = summary.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDT";
  if (paperCashElement) paperCashElement.textContent = summary.cash.toFixed(2) + " USDT";
  if (paperRealizedElement) paperRealizedElement.textContent = summary.realizedPnl.toFixed(2) + " USDT";
  if (paperPositionElement) paperPositionElement.textContent = (paperAccount.positions.BTCUSDT?.quantity ?? 0).toFixed(6) + " BTC";
  if (paperFillsElement) {
    const recent = [...paperAccount.fills].slice(-5).reverse();
    paperFillsElement.textContent = recent.length
      ? recent.map((fill) => `${fill.side.toUpperCase()} ${fill.quantity} BTC · ${fill.price.toFixed(2)} · fee ${fill.fee.toFixed(2)} USDT`).join("\n")
      : "No paper fills yet";
  }
  const canTrade = marketDataTrusted && latestBtcPrice !== null && latestBtcFetchedAt !== null && Date.now() - latestBtcFetchedAt <= 5 * 60 * 1000;
  if (paperBuyButton) paperBuyButton.disabled = !canTrade || paperOrderInFlight;
  if (paperSellButton) paperSellButton.disabled = !canTrade || paperOrderInFlight || !paperAccount.positions.BTCUSDT;
}

async function initializePaperAccount(): Promise<void> {
  try {
    paperAccount = await paperStore.load() ?? createPaperAccount();
    await paperStore.save(paperAccount);
    renderPaperAccount();
    if (paperStatusElement) paperStatusElement.textContent = "Local account ready · simulated funds only · data stored on this device";
  } catch (error) {
    if (paperStatusElement) paperStatusElement.textContent = error instanceof Error ? error.message : "Local account storage unavailable";
    if (paperBuyButton) paperBuyButton.disabled = true;
    if (paperSellButton) paperSellButton.disabled = true;
  }
}

async function submitPaperOrder(side: "buy" | "sell"): Promise<void> {
  if (!paperAccount || latestBtcPrice === null || !paperQuantityInput || !paperStatusElement) return;
  if (latestBtcFetchedAt === null || Date.now() - latestBtcFetchedAt > 5 * 60 * 1000) {
    latestBtcPrice = null;
    renderPaperAccount();
    paperStatusElement.textContent = "Market snapshot expired; refresh before trading";
    return;
  }
  if (paperOrderInFlight) return;
  paperOrderInFlight = true;
  renderPaperAccount();
  const quantity = Number(paperQuantityInput.value);
  try {
    const timestamp = Date.now();
    const marked = markPaperAccount(paperAccount, { BTCUSDT: latestBtcPrice }, timestamp);
    const next = executePaperMarketOrder(marked, {
      symbol: "BTCUSDT", side, quantity, referencePrice: latestBtcPrice, timestamp,
    });
    await paperStore.save(next);
    paperAccount = next;
    renderPaperAccount();
    paperStatusElement.textContent = `Paper ${side} filled · no exchange order was sent`;
  } catch (error) {
    paperStatusElement.textContent = error instanceof Error ? error.message : "Paper order rejected";
  } finally {
    paperOrderInFlight = false;
    renderPaperAccount();
  }
}

paperBuyButton?.addEventListener("click", () => { void submitPaperOrder("buy"); });
paperSellButton?.addEventListener("click", () => { void submitPaperOrder("sell"); });

async function loadMarketSnapshot(): Promise<void> {
  if (!priceElement || !changeElement || !rsiElement || !updatedElement || !refreshButton) return;
  refreshButton.disabled = true;
  refreshButton.textContent = "Loading…";
  changeElement.textContent = "Fetching latest completed hourly candles";
  latestBtcPrice = null;
  latestBtcFetchedAt = null;
  marketDataTrusted = false;
  renderPaperAccount();
  try {
    const intelligence = await loadMarketIntelligence({
      symbol: "BTCUSDT",
      instrumentCategory: "spot",
      volumeUnit: "base",
      evaluationTime: Date.now(),
      config: MARKET_REGIME_CONFIG,
      providers: marketProviders,
      cache: marketCache,
      historyLimit: 60,
      minimumCandles: 25,
      crossFeedToleranceBps: 50,
    });
    const snapshot = intelligence.snapshots["1h"];
    if (!snapshot) throw new Error("No usable completed 1H market snapshot is available");
    const candles = snapshot.candles;
    if (candles.length < 15) throw new Error("Not enough completed candles to calculate RSI");
    const presentation = buildMarketIntelligencePresentation({
      snapshot: intelligence.snapshot,
      crossFeedStatus: intelligence.crossFeedStatus,
      marketDataTrusted: intelligence.marketDataTrusted &&
        intelligence.snapshot.dataQuality === "pass",
    });
    for (const [field, element] of intelligenceElements) {
      if (element) element.textContent = presentation[field];
    }
    marketDataTrusted = presentation.paperEligibility === "PAPER DATA GATE PASSED";
    if (qualityElement) {
      qualityElement.textContent = "Data quality: " + presentation.quality +
        " · Cross-feed: " + presentation.crossFeed;
      qualityElement.dataset.quality = presentation.quality === "FAIL" ? "fail" : presentation.quality;
    }
    const firstClose = candles[0].close;
    if (firstClose <= 0) throw new Error("Invalid reference price in market data");
    const last = candles[candles.length - 1];
    const change = ((last.close - firstClose) / firstClose) * 100;
    const rsiValues = rsi(candles.map((candle) => candle.close), 14);
    const latestRsi = rsiValues[rsiValues.length - 1];
    latestBtcPrice = last.close;
    latestBtcFetchedAt = marketDataTrusted ? Date.now() : 0;
    if (paperAccount) {
      paperAccount = markPaperAccount(paperAccount, { BTCUSDT: last.close }, Date.now());
      await paperStore.save(paperAccount);
      renderPaperAccount();
    }

    priceElement.textContent = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(last.close) + " USDT";
    changeElement.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "% over 24 hourly intervals" +
      (snapshot.stale ? " · paper orders locked" : "");
    changeElement.dataset.direction = change >= 0 ? "up" : "down";
    rsiElement.textContent = latestRsi === null ? "—" : latestRsi.toFixed(1);
    updatedElement.textContent = (snapshot.stale ? "STALE LOCAL CACHE · " : snapshot.provider + " · ") +
      "Last closed candle · " + new Date(last.timestamp).toLocaleString();
  } catch (error) {
    latestBtcPrice = null;
    latestBtcFetchedAt = null;
    marketDataTrusted = false;
    renderPaperAccount();
    changeElement.textContent = error instanceof Error ? error.message : "Market data unavailable";
    changeElement.dataset.direction = "neutral";
    rsiElement.textContent = "—";
    updatedElement.textContent = "Check connection or retry";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

refreshButton?.addEventListener("click", () => { void loadMarketSnapshot(); });
void initializePaperAccount();
void loadMarketSnapshot();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
