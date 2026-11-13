export interface PaperBrokerConfig {
  initialCash: number;
  feeRate: number;
  slippageRate: number;
  maxPositionValueFraction: number;
  maxDailyLossFraction: number;
}

export interface PaperPosition {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
}

export interface PaperFill {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  referencePrice: number;
  price: number;
  fee: number;
  timestamp: number;
  realizedPnl: number;
}

export interface PaperAccount {
  readonly initialCash: number;
  readonly config: Readonly<PaperBrokerConfig>;
  readonly cash: number;
  readonly realizedPnl: number;
  readonly totalFees: number;
  readonly positions: Readonly<Record<string, PaperPosition>>;
  readonly fills: readonly PaperFill[];
  readonly dailyStartEquity: number;
  readonly tradingDay: string;
}

export interface PaperOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  referencePrice: number;
  timestamp: number;
}

const DEFAULT_CONFIG: PaperBrokerConfig = {
  initialCash: 10_000,
  feeRate: 0.001,
  slippageRate: 0.001,
  maxPositionValueFraction: 0.25,
  maxDailyLossFraction: 0.03,
};

function validateConfig(config: PaperBrokerConfig): void {
  if (!Number.isFinite(config.initialCash) || config.initialCash <= 0) throw new RangeError("initialCash must be positive");
  for (const [name, value] of Object.entries({
    feeRate: config.feeRate,
    slippageRate: config.slippageRate,
    maxPositionValueFraction: config.maxPositionValueFraction,
    maxDailyLossFraction: config.maxDailyLossFraction,
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  }
  if (config.maxPositionValueFraction === 0) throw new RangeError("maxPositionValueFraction must be greater than zero");
}

function utcDay(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError("timestamp must be a non-negative safe integer");
  return new Date(timestamp).toISOString().slice(0, 10);
}

function equityOf(account: PaperAccount): number {
  return account.cash + Object.values(account.positions).reduce(
    (sum, position) => sum + position.quantity * position.markPrice, 0,
  );
}

export function createPaperAccount(overrides: Partial<PaperBrokerConfig> = {}, timestamp = Date.now()): PaperAccount {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  validateConfig(config);
  return {
    initialCash: config.initialCash,
    config: Object.freeze({ ...config }),
    cash: config.initialCash,
    realizedPnl: 0,
    totalFees: 0,
    positions: {},
    fills: [],
    dailyStartEquity: config.initialCash,
    tradingDay: utcDay(timestamp),
  };
}

export function markPaperAccount(
  account: PaperAccount,
  prices: Readonly<Record<string, number>>,
  timestamp: number,
): PaperAccount {
  const day = utcDay(timestamp);
  const positions = { ...account.positions };
  for (const [symbol, position] of Object.entries(positions)) {
    const nextPrice = prices[symbol];
    if (nextPrice !== undefined) {
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) throw new RangeError("Mark prices must be positive finite numbers");
      positions[symbol] = { ...position, markPrice: nextPrice };
    }
  }
  const interim = { ...account, positions };
  const rolled = day === account.tradingDay
    ? interim
    : { ...interim, tradingDay: day, dailyStartEquity: equityOf(interim) };
  return rolled;
}

export function executePaperMarketOrder(
  account: PaperAccount,
  request: PaperOrderRequest,
): PaperAccount {
  const config = account.config;
  validateConfig(config);
  const symbol = request.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new TypeError("symbol must be an exchange-style alphanumeric pair");
  if (request.side !== "buy" && request.side !== "sell") throw new TypeError("side must be buy or sell");
  if (!Number.isFinite(request.quantity) || request.quantity <= 0) throw new RangeError("quantity must be positive");
  if (!Number.isFinite(request.referencePrice) || request.referencePrice <= 0) throw new RangeError("referencePrice must be positive");
  const day = utcDay(request.timestamp);
  if (day !== account.tradingDay) throw new Error("Mark the account for the new trading day before submitting orders");

  const equity = equityOf(account);
  const dailyLoss = (account.dailyStartEquity - equity) / account.dailyStartEquity;

  const executionPrice = request.side === "buy"
    ? request.referencePrice * (1 + config.slippageRate)
    : request.referencePrice * (1 - config.slippageRate);
  if (executionPrice <= 0) throw new RangeError("Execution price must remain positive after slippage");
  const notional = executionPrice * request.quantity;
  const fee = notional * config.feeRate;
  const positions = { ...account.positions };
  let cash = account.cash;
  let realizedPnl = account.realizedPnl;
  let fillRealizedPnl = 0;

  if (request.side === "buy") {
    if (dailyLoss >= config.maxDailyLossFraction) throw new Error("Daily loss limit reached; new orders are blocked");
    const currentPositionValue = (positions[symbol]?.quantity ?? 0) * executionPrice;
    if (currentPositionValue + notional > equity * config.maxPositionValueFraction) {
      throw new Error("Order exceeds the position allocation limit");
    }
    if (notional + fee > cash) throw new Error("Insufficient cash for order including fees");
    const current = positions[symbol];
    const oldQuantity = current?.quantity ?? 0;
    const nextQuantity = oldQuantity + request.quantity;
    const averageEntryPrice = current
      ? (current.averageEntryPrice * oldQuantity + executionPrice * request.quantity + fee) / nextQuantity
      : executionPrice + fee / request.quantity;
    positions[symbol] = { symbol, quantity: nextQuantity, averageEntryPrice, markPrice: request.referencePrice };
    cash -= notional + fee;
  } else {
    const current = positions[symbol];
    if (!current || request.quantity > current.quantity + 1e-12) throw new Error("Insufficient position quantity to sell");
    fillRealizedPnl = (executionPrice - current.averageEntryPrice) * request.quantity - fee;
    realizedPnl += fillRealizedPnl;
    cash += notional - fee;
    const remaining = current.quantity - request.quantity;
    if (remaining <= 1e-12) delete positions[symbol];
    else positions[symbol] = { ...current, quantity: remaining };
  }

  const fill: PaperFill = {
    id: `paper-${request.timestamp}-${account.fills.length + 1}`,
    symbol, side: request.side, quantity: request.quantity,
    referencePrice: request.referencePrice, price: executionPrice, fee,
    timestamp: request.timestamp, realizedPnl: fillRealizedPnl,
  };
  return {
    ...account,
    cash,
    realizedPnl,
    totalFees: account.totalFees + fee,
    positions,
    fills: [...account.fills, fill],
  };
}

export function getPaperAccountSummary(account: PaperAccount): {
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  cash: number;
} {
  const unrealizedPnl = Object.values(account.positions).reduce(
    (sum, position) => sum + (position.markPrice - position.averageEntryPrice) * position.quantity, 0,
  );
  return {
    equity: equityOf(account),
    unrealizedPnl,
    realizedPnl: account.realizedPnl,
    totalFees: account.totalFees,
    cash: account.cash,
  };
}
