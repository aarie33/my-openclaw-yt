import YahooFinance from "yahoo-finance2";
import { LQ45_TICKERS } from "./lq45-tickers.js";

interface YfQuoteRow {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
  [key: string]: unknown;
}

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

export interface OhlcvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerFeatures {
  ticker: string;
  latest_close: number;
  latest_volume: number;
  ma5_volume: number;
  ma20_volume: number;
  volume_ratio: number;
  daily_return_pct: number;
  weekly_return_pct: number;
  monthly_return_pct: number;
  ma20_price: number;
  ma50_price: number;
  dist_ma20_pct: number;
  dist_ma50_pct: number;
  is_breakout: boolean;
  is_new_high: boolean;
  resistance_level: number;
  ohlcv: OhlcvRow[];
}

export interface ScanMarketResult {
  scan_date: string;
  total_tickers: number;
  success_count: number;
  failed_tickers: string[];
  market_data: Record<string, TickerFeatures>;
}

export async function scanMarket({
  tickers,
  period_days,
}: {
  tickers?: string[];
  period_days: number;
}): Promise<ScanMarketResult> {
  const targetTickers = tickers && tickers.length > 0 ? tickers : LQ45_TICKERS;
  const market_data: Record<string, TickerFeatures> = {};
  const failed_tickers: string[] = [];

  // Fetch paralel dalam batch 10 untuk jaga rate limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < targetTickers.length; i += BATCH_SIZE) {
    const batch = targetTickers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ticker) => {
        try {
          const rows = await fetchOhlcv(ticker, period_days);
          if (rows.length < 22) {
            failed_tickers.push(ticker);
            return;
          }
          market_data[ticker] = computeFeatures(ticker, rows);
        } catch {
          failed_tickers.push(ticker);
        }
      })
    );
    if (i + BATCH_SIZE < targetTickers.length) await sleep(500);
  }

  return {
    scan_date: new Date().toISOString().slice(0, 10),
    total_tickers: targetTickers.length,
    success_count: Object.keys(market_data).length,
    failed_tickers,
    market_data,
  };
}

async function fetchOhlcv(ticker: string, period_days: number): Promise<OhlcvRow[]> {
  const period1 = daysAgo(period_days + 14); // buffer weekend/holiday
  const result = await yf.chart(ticker, { period1, interval: "1d" });

  return (result.quotes as YfQuoteRow[])
    .filter((q) => q.close != null && q.volume != null && q.volume > 0)
    .map((q) => ({
      date: new Date(q.date).toISOString().slice(0, 10),
      open: q.open ?? q.close!,
      high: q.high ?? q.close!,
      low: q.low ?? q.close!,
      close: q.close!,
      volume: q.volume!,
    }));
}

function computeFeatures(ticker: string, rows: OhlcvRow[]): TickerFeatures {
  const closes = rows.map((r) => r.close);
  const volumes = rows.map((r) => r.volume);
  const highs = rows.map((r) => r.high);
  const n = rows.length;

  const latest_close = closes[n - 1];
  const latest_volume = volumes[n - 1];

  const ma5_volume = avg(volumes.slice(-5));
  const ma20_volume = avg(volumes.slice(-20));
  const volume_ratio = ma20_volume > 0 ? latest_volume / ma20_volume : 0;

  const daily_return_pct = pctChange(closes[n - 2], closes[n - 1]);
  const weekly_return_pct = n >= 6 ? pctChange(closes[n - 6], closes[n - 1]) : 0;
  const monthly_return_pct = n >= 21 ? pctChange(closes[n - 21], closes[n - 1]) : 0;

  const ma20_price = avg(closes.slice(-20));
  const ma50_price = avg(closes.slice(-Math.min(50, n)));
  const dist_ma20_pct = pctChange(ma20_price, latest_close);
  const dist_ma50_pct = pctChange(ma50_price, latest_close);

  const resistance_level = Math.max(...highs.slice(-21, -1)); // 20-day resistance
  const is_breakout = latest_close > resistance_level;

  const high_52w = Math.max(...highs.slice(-Math.min(252, n)));
  const is_new_high = latest_close >= high_52w * 0.99;

  return {
    ticker,
    latest_close: r2(latest_close),
    latest_volume,
    ma5_volume: Math.round(ma5_volume),
    ma20_volume: Math.round(ma20_volume),
    volume_ratio: r2(volume_ratio),
    daily_return_pct: r2(daily_return_pct),
    weekly_return_pct: r2(weekly_return_pct),
    monthly_return_pct: r2(monthly_return_pct),
    ma20_price: r2(ma20_price),
    ma50_price: r2(ma50_price),
    dist_ma20_pct: r2(dist_ma20_pct),
    dist_ma50_pct: r2(dist_ma50_pct),
    is_breakout,
    is_new_high,
    resistance_level: r2(resistance_level),
    ohlcv: rows,
  };
}

const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const pctChange = (from: number, to: number) => from === 0 ? 0 : ((to - from) / from) * 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
