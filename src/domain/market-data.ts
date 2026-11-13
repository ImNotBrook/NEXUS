import { validateCandles, type Candle } from "./candles";

export interface MarketDataProvider {
  readonly name: string;
  fetchCandles(request: { symbol: string; interval: string; limit: number }): Promise<Candle[]>;
}

export interface MarketSnapshot {
  symbol: string;
  interval: string;
  provider: string;
  fetchedAt: number;
  stale: boolean;
  candles: Candle[];
}

export interface MarketSnapshotCache {
  load(symbol: string, interval: string): Promise<MarketSnapshot | null>;
  save(snapshot: MarketSnapshot): Promise<void>;
}

export interface ResolveMarketSnapshotOptions {
  symbol: string;
  interval: string;
  now?: number;
  limit?: number;
  minCandles?: number;
  maxCacheAgeMs?: number;
}

export async function resolveMarketSnapshot(
  providers: readonly MarketDataProvider[],
  cache: MarketSnapshotCache,
  options: ResolveMarketSnapshotOptions,
): Promise<MarketSnapshot> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 500;
  const minCandles = options.minCandles ?? 1;
  const maxCacheAgeMs = options.maxCacheAgeMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("now must be a non-negative timestamp");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError("limit must be between 1 and 1000");
  if (!Number.isInteger(minCandles) || minCandles < 1 || minCandles > limit) throw new RangeError("minCandles must be between 1 and limit");
  if (!Number.isSafeInteger(maxCacheAgeMs) || maxCacheAgeMs < 0) throw new RangeError("maxCacheAgeMs must be non-negative");
  if (!options.symbol.trim() || !options.interval.trim()) throw new TypeError("symbol and interval are required");

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const candles = validateCandles(await provider.fetchCandles({
        symbol: options.symbol.trim().toUpperCase(),
        interval: options.interval,
        limit,
      }));
      if (candles.length < minCandles) throw new Error("provider returned " + candles.length + " candles; minimum required is " + minCandles);
      const snapshot: MarketSnapshot = {
        symbol: options.symbol.trim().toUpperCase(),
        interval: options.interval,
        provider: provider.name,
        fetchedAt: now,
        stale: false,
        candles,
      };
      try {
        await cache.save(snapshot);
      } catch {
        // Fresh data remains usable if optional local caching is unavailable.
      }
      return snapshot;
    } catch (error) {
      failures.push(provider.name + ": " + (error instanceof Error ? error.message : "unknown provider error"));
    }
  }

  const cached = await cache.load(options.symbol.trim().toUpperCase(), options.interval);
  if (cached && cached.symbol === options.symbol.trim().toUpperCase() &&
      cached.interval === options.interval && cached.candles.length >= minCandles && Number.isSafeInteger(cached.fetchedAt) &&
      cached.fetchedAt <= now && now - cached.fetchedAt <= maxCacheAgeMs) {
    return { ...cached, candles: validateCandles(cached.candles), stale: true };
  }

  throw new Error("No fresh market data available. " + failures.join("; "));
}
