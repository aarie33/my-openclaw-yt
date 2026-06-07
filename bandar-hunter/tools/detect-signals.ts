import type { TickerFeatures } from "./scan-market.js";

export interface SignalResult {
  ticker: string;
  has_signal: boolean;
  signals: {
    volume_anomaly: boolean;
    breakout: boolean;
    momentum_expansion: boolean;
    smart_money: boolean;
    new_high: boolean;
  };
  signal_count: number;
  // Semua features dari scan_market ikut dibawa
  features: TickerFeatures;
}

export interface DetectSignalsResult {
  scan_date: string;
  total_scanned: number;
  signal_count: number;
  summary: {
    volume_anomaly: number;
    breakout: number;
    momentum_expansion: number;
    smart_money: number;
  };
  signal_data: Record<string, SignalResult>;
}

export async function detectSignals({
  market_data,
  volume_threshold,
  breakout_lookback,
  min_price_change,
}: {
  market_data: Record<string, any>;
  volume_threshold: number;
  breakout_lookback: number;
  min_price_change: number;
}): Promise<DetectSignalsResult> {
  const signal_data: Record<string, SignalResult> = {};
  const summary = { volume_anomaly: 0, breakout: 0, momentum_expansion: 0, smart_money: 0 };

  for (const [ticker, feat] of Object.entries(market_data) as [string, TickerFeatures][]) {
    const signals = detectForTicker(feat, volume_threshold, min_price_change);

    if (signals.has_signal) {
      signal_data[ticker] = {
        ticker,
        has_signal: true,
        signals: signals.signals,
        signal_count: signals.signal_count,
        features: feat,
      };

      if (signals.signals.volume_anomaly) summary.volume_anomaly++;
      if (signals.signals.breakout) summary.breakout++;
      if (signals.signals.momentum_expansion) summary.momentum_expansion++;
      if (signals.signals.smart_money) summary.smart_money++;
    }
  }

  return {
    scan_date: new Date().toISOString().slice(0, 10),
    total_scanned: Object.keys(market_data).length,
    signal_count: Object.keys(signal_data).length,
    summary,
    signal_data,
  };
}

function detectForTicker(
  feat: TickerFeatures,
  volume_threshold: number,
  min_price_change: number
): { has_signal: boolean; signals: SignalResult["signals"]; signal_count: number } {
  const vol_ratio = feat.volume_ratio ?? 0;
  const daily_ret = feat.daily_return_pct ?? 0;
  const is_breakout = feat.is_breakout ?? false;
  const is_new_high = feat.is_new_high ?? false;

  // 1. Volume Anomaly — volume hari ini jauh di atas rata-rata
  const volume_anomaly = vol_ratio >= volume_threshold;

  // 2. Breakout — tembus resistance + ada volume support
  const breakout = is_breakout && vol_ratio >= 1.2;

  // 3. Momentum Expansion — harga naik signifikan + volume besar
  const momentum_expansion = daily_ret >= min_price_change && vol_ratio >= volume_threshold * 0.8;

  // 4. Smart Money — volume naik tapi harga belum gerak (akumulasi diam-diam)
  const smart_money = vol_ratio >= 1.5 && Math.abs(daily_ret) <= 1.5 && !is_breakout;

  const signals = { volume_anomaly, breakout, momentum_expansion, smart_money, new_high: is_new_high };
  const signal_count = [volume_anomaly, breakout, momentum_expansion, smart_money].filter(Boolean).length;
  const has_signal = signal_count > 0;

  return { has_signal, signals, signal_count };
}
