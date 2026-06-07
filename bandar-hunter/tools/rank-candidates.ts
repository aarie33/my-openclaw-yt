import type { SignalResult } from "./detect-signals.js";

export interface RankedCandidate {
  rank: number;
  ticker: string;
  score: number;
  score_detail: {
    volume_strength: number;
    breakout_quality: number;
    relative_strength: number;
    trend_alignment: number;
  };
  signals: SignalResult["signals"];
  signal_count: number;
  features: SignalResult["features"];
}

export interface RankCandidatesResult {
  scan_date: string;
  total_candidates: number;
  top_n: number;
  ranked: RankedCandidate[];
}

export async function rankCandidates({
  signal_data,
  top_n,
}: {
  signal_data: Record<string, any>;
  top_n: number;
}): Promise<RankCandidatesResult> {
  const entries = Object.values(signal_data) as SignalResult[];

  if (entries.length === 0) {
    return {
      scan_date: new Date().toISOString().slice(0, 10),
      total_candidates: 0,
      top_n,
      ranked: [],
    };
  }

  // Hitung Relative Strength score lintas universe kandidat hari ini
  const rsScores = computeRelativeStrength(entries);

  // Score setiap kandidat
  const scored = entries.map((entry) => {
    const rs = rsScores.get(entry.ticker) ?? 50;
    const detail = computeScore(entry, rs);
    return { entry, detail };
  });

  // Sort DESC by total score
  scored.sort((a, b) => b.detail.total - a.detail.total);

  const ranked: RankedCandidate[] = scored.slice(0, top_n).map(({ entry, detail }, i) => ({
    rank: i + 1,
    ticker: entry.ticker,
    score: detail.total,
    score_detail: {
      volume_strength: detail.volume_strength,
      breakout_quality: detail.breakout_quality,
      relative_strength: detail.relative_strength,
      trend_alignment: detail.trend_alignment,
    },
    signals: entry.signals,
    signal_count: entry.signal_count,
    features: entry.features,
  }));

  return {
    scan_date: new Date().toISOString().slice(0, 10),
    total_candidates: entries.length,
    top_n,
    ranked,
  };
}

// ── Relative Strength ──────────────────────────────────────────────────────────
// RS = percentile rank monthly_return dalam universe kandidat hari ini
function computeRelativeStrength(entries: SignalResult[]): Map<string, number> {
  const returns = entries.map((e) => ({
    ticker: e.ticker,
    monthly: e.features.monthly_return_pct ?? 0,
  }));

  const values = returns.map((r) => r.monthly);

  return new Map(
    returns.map(({ ticker, monthly }) => {
      const rank = values.filter((v) => v <= monthly).length / values.length * 100;
      return [ticker, Math.round(rank)];
    })
  );
}

// ── Scoring formula ────────────────────────────────────────────────────────────
function computeScore(
  entry: SignalResult,
  rs_score: number
): {
  total: number;
  volume_strength: number;
  breakout_quality: number;
  relative_strength: number;
  trend_alignment: number;
} {
  const feat = entry.features;
  const signals = entry.signals;

  // 1. Volume Strength (0–100)
  // 1× = 0, 2× = 33, 4× = 100, cap 100
  const vol_ratio = feat.volume_ratio ?? 0;
  const volume_strength = Math.min(100, Math.max(0, ((vol_ratio - 1) / 3) * 100));

  // 2. Breakout Quality (0–100)
  let breakout_quality = 0;
  if (signals.breakout) {
    breakout_quality = 65;
    if (signals.new_high) breakout_quality += 15;
    // Bonus: semakin jauh di atas resistance makin kuat konfirmasinya
    breakout_quality += Math.min(20, (feat.dist_ma20_pct ?? 0) * 2);
  } else if (signals.momentum_expansion) {
    breakout_quality = 40;
  } else if (signals.smart_money) {
    // Smart money lebih konservatif tapi tetap dapat nilai
    breakout_quality = 25;
  }
  breakout_quality = Math.min(100, breakout_quality);

  // 3. Relative Strength (0–100) — sudah dihitung di luar
  const relative_strength = rs_score;

  // 4. Trend Alignment (0–100)
  let trend_alignment = 0;
  if ((feat.dist_ma20_pct ?? 0) > 0) trend_alignment += 30;
  if ((feat.dist_ma50_pct ?? 0) > 0) trend_alignment += 20;
  if ((feat.daily_return_pct ?? 0) > 0) trend_alignment += 25;
  if ((feat.weekly_return_pct ?? 0) > 0) trend_alignment += 25;
  trend_alignment = Math.min(100, trend_alignment);

  // Weighted total — bobot sesuai PRD
  let total =
    volume_strength   * 0.40 +
    breakout_quality  * 0.30 +
    relative_strength * 0.20 +
    trend_alignment   * 0.10;

  // Bonus kecil untuk multi-signal
  if (entry.signal_count >= 3) total = Math.min(100, total + 5);

  return {
    total: Math.round(Math.min(100, Math.max(0, total))),
    volume_strength: Math.round(volume_strength),
    breakout_quality: Math.round(breakout_quality),
    relative_strength: Math.round(relative_strength),
    trend_alignment: Math.round(trend_alignment),
  };
}
