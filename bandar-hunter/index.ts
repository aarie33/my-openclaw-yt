import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanMarket } from "./tools/scan-market.js";
import { detectSignals } from "./tools/detect-signals.js";
import { rankCandidates } from "./tools/rank-candidates.js";

const server = new McpServer({
  name: "bandar-hunter",
  version: "2.0.0",
});

// ── Tool 1: scan_market ────────────────────────────────────────────────────────
server.registerTool(
  "scan_market",
  {
    description:
      "Ambil data OHLCV dari Yahoo Finance untuk semua saham LQ45. " +
      "Return harga, volume, dan indikator teknikal 60 hari terakhir.",
    inputSchema: {
      tickers: z
        .array(z.string())
        .optional()
        .describe("Daftar ticker (format .JK, misal BBCA.JK). Kosong = pakai LQ45 default."),
      period_days: z
        .number().int().min(30).max(120).default(60)
        .describe("Jumlah hari historis untuk kalkulasi indikator. Default: 60"),
    },
  },
  async ({ tickers, period_days }) => {
    try {
      const result = await scanMarket({ tickers, period_days: period_days ?? 60 });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error scan_market: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 2: detect_signals ─────────────────────────────────────────────────────
server.registerTool(
  "detect_signals",
  {
    description:
      "Deteksi sinyal aktif: Volume Anomaly, Breakout, Momentum Expansion, Smart Money. " +
      "Terima market_data sebagai JSON string dari output scan_market.",
    inputSchema: {
      market_data_json: z
        .string()
        .describe("JSON string dari field market_data yang dihasilkan scan_market"),
      volume_threshold: z
        .number().min(1.0).max(10.0).default(2.0)
        .describe("Minimum volume ratio untuk Volume Anomaly. Default: 2.0 (artinya 2× MA20)"),
      breakout_lookback: z
        .number().int().min(5).max(60).default(20)
        .describe("Lookback N hari untuk deteksi level resistance. Default: 20"),
      min_price_change: z
        .number().min(0).max(20).default(1.0)
        .describe("Minimum daily return % untuk sinyal Momentum. Default: 1.0"),
    },
  },
  async ({ market_data_json, volume_threshold, breakout_lookback, min_price_change }) => {
    try {
      const market_data = JSON.parse(market_data_json);
      const result = await detectSignals({
        market_data,
        volume_threshold: volume_threshold ?? 2.0,
        breakout_lookback: breakout_lookback ?? 20,
        min_price_change: min_price_change ?? 1.0,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error detect_signals: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 3: rank_candidates ────────────────────────────────────────────────────
server.registerTool(
  "rank_candidates",
  {
    description:
      "Beri skor 0-100 setiap kandidat bersinyal dan return TOP N terbaik. " +
      "Formula: 40% Volume Strength + 30% Breakout Quality + 20% Relative Strength + 10% Trend Alignment. " +
      "Terima signal_data sebagai JSON string dari output detect_signals.",
    inputSchema: {
      signal_data_json: z
        .string()
        .describe("JSON string dari field signal_data yang dihasilkan detect_signals"),
      top_n: z
        .number().int().min(1).max(20).default(5)
        .describe("Jumlah kandidat terbaik yang dikembalikan. Default: 5"),
    },
  },
  async ({ signal_data_json, top_n }) => {
    try {
      const signal_data = JSON.parse(signal_data_json);
      const result = await rankCandidates({ signal_data, top_n: top_n ?? 5 });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error rank_candidates: ${err.message}` }], isError: true };
    }
  }
);

// ── Start MCP server ───────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
