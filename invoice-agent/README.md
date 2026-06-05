# 🦞 agent-invoice

> OpenClaw plugin — Scan kuitansi Gmail → catat otomatis ke Google Sheets

---

## Struktur Plugin

```
agent-invoice/
├── index.ts                    ← Entry point, daftarkan semua tools ke OpenClaw
├── openclaw.plugin.json        ← Manifest plugin
├── package.json
├── SOUL.md                     ← Copy ke ~/.openclaw/agents/main/SOUL.md
└── tools/
    ├── gmail-auth.js           ← One-time OAuth setup
    ├── gmail-client.ts         ← Shared Google OAuth client
    ├── scan-invoice-emails.ts  ← Tool: scan & parse email kuitansi
    ├── record-to-sheets.ts     ← Tool: catat data ke Google Sheets
    └── get-expense-summary.ts  ← Tool: ringkasan pengeluaran
```

### Tools yang tersedia

| Tool | Deskripsi |
|---|---|
| `scan_invoice_emails` | Scan Gmail, temukan & parse email kuitansi |
| `record_to_sheets` | Catat data pengeluaran ke Google Sheets |
| `get_expense_summary` | Ringkasan pengeluaran per kategori/bulan/vendor |

---

## Setup

### 1 — Prasyarat

- OpenClaw sudah terinstall dan Gateway sudah berjalan
- Node.js >= 22
- Akun Google Cloud (gratis)

### 2 — Google Cloud Setup

1. Buka https://console.cloud.google.com → buat project baru
2. **APIs & Services → Library**, aktifkan:
   - ✅ Gmail API
   - ✅ Google Sheets API
3. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
4. Download JSON → simpan sebagai:
   ```
   ~/.openclaw/agents/main/gmail-credentials.json
   ```

### 3 — Install dependencies & autentikasi Gmail

```bash
cd agent-invoice
npm install

# Setup OAuth Gmail (sekali saja)
npm run auth:gmail
```

Ikuti instruksi di terminal — buka URL, login, paste kode.
Token tersimpan otomatis di `~/.openclaw/agents/main/gmail-token.json`.

### 4 — Install plugin ke OpenClaw

```bash
# Dari folder plugin ini
openclaw plugins install ./

# Verifikasi tools terdaftar
openclaw plugins inspect agent-invoice --runtime
```

### 5 — Setup SOUL agent (opsional tapi disarankan)

```bash
cp SOUL.md ~/.openclaw/agents/main/SOUL.md
```

### 6 — Daftarkan jadwal cron harian jam 06:00 WIB

```bash
openclaw cron add \
  --name "Scan Kuitansi Harian" \
  --cron "0 6 * * *" \
  --timezone "Asia/Jakarta" \
  --session main \
  --system-event "Scan email kuitansi 24 jam terakhir dan catat semua yang belum dicatat ke Google Sheets dengan spreadsheet_id: GANTI_DENGAN_ID_KAMU"
```

Cek jadwal terdaftar:
```bash
openclaw cron list
```

---

## Cara Pakai (Chat)

Setelah plugin terpasang, chat langsung ke OpenClaw agent kamu:

```
Scan email kuitansi 7 hari terakhir

Catat semua kuitansi tadi ke sheets dengan ID: 1BxiMVs0XRA5nFM...

Berapa total pengeluaran bulan ini per kategori?

Tunjukkan pengeluaran bulan Juni, kelompokkan per vendor
```

---

## Konfigurasi tools.allow (untuk get_expense_summary)

Tool `get_expense_summary` ditandai optional. Aktifkan di `~/.openclaw/openclaw.json`:

```json
{
  "tools": {
    "allow": ["get_expense_summary"]
  }
}
```

---

## Troubleshooting

| Error | Solusi |
|---|---|
| `gmail-credentials.json tidak ditemukan` | Ikuti langkah 2 di atas |
| `gmail-token.json tidak ditemukan` | Jalankan `npm run auth:gmail` |
| `Token expired` | Jalankan ulang `npm run auth:gmail` |
| Tool tidak muncul di OpenClaw | `openclaw gateway restart` |
| Spreadsheet tidak bisa ditulis | Pastikan akun Google punya akses edit ke spreadsheet |
