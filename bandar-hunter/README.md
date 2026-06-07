# 🕵️ Bandar Hunter AI

Plugin OpenClaw yang scan seluruh saham LQ45 setiap hari bursa jam 15:00 WIB,
deteksi aktivitas tidak biasa, dan kirim analisis langsung ke chat.

---

## Install

```bash
cd bandar-hunter
npm install
npm run build
```

Daftarkan ke OpenClaw:

```bash
openclaw plugins install ./bandar-hunter
```

---

## Tools yang Tersedia

Agent akan otomatis pakai ketiga tools ini secara berurutan:

| Tool | Fungsi |
|------|--------|
| `scan_market` | Ambil OHLCV + hitung indikator teknikal (MA, volume ratio, breakout) |
| `detect_signals` | Deteksi 4 tipe sinyal: Volume Anomaly, Breakout, Momentum, Smart Money |
| `rank_candidates` | Scoring 0-100 dan return TOP N kandidat terbaik |

---

## Cara Pakai

Trigger otomatis setiap hari bursa jam **15:00 WIB**, atau chat manual:

```
scan saham hari ini
```
```
bandar hunter lq45
```
```
ada breakout hari ini?
```

---

## Kustomisasi Ticker

Default pakai LQ45. Bisa custom di chat:

```
scan saham BBCA.JK TLKM.JK GOTO.JK BUKA.JK saja
```

---

## Struktur Project

```
bandar-hunter/
├── SOUL.md                  ← Persona & instruksi agent
├── openclaw.plugin.json     ← Registrasi plugin OpenClaw
├── index.ts                 ← MCP server entry point
├── tools/
│   ├── lq45-tickers.ts      ← Daftar 47 saham LQ45
│   ├── scan-market.ts       ← Fetch OHLCV + feature engineering
│   ├── detect-signals.ts    ← Signal detection (4 tipe)
│   └── rank-candidates.ts   ← Scoring & ranking
├── dist/                    ← Output TypeScript (auto-generated)
├── package.json
└── tsconfig.json
```

---

## Formula Skor

```
Score = (Volume Strength × 40%)
      + (Breakout Quality × 30%)
      + (Relative Strength × 20%)
      + (Trend Alignment × 10%)
```

Bonus +5 poin jika saham punya 3+ sinyal aktif sekaligus.
