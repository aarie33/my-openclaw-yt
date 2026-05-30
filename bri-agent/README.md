# 🏦 BRI Bank Statement Agent untuk OpenClaw

Agent OpenClaw yang membaca email mutasi rekening BRI dari Gmail dan membuat ringkasan keuangan harian/bulanan menggunakan DeepSeek V4.

---

## 📁 Struktur File

```
bri-agent/
├── openclaw.json              ← Konfigurasi utama OpenClaw + DeepSeek
├── package.json               ← Dependencies Node.js untuk MCP server
├── tools/
│   └── gmail-mcp-server.js   ← MCP Server yang konek ke Gmail API
└── skills/
    └── bri-analyst-instructions.md  ← System prompt agent
```

---

## 🚀 Langkah Setup (Ikuti Urutan Ini!)

### Step 1 — Install Dependencies MCP Server

```bash
cd ~/bri-agent
npm install
```

Ini menginstall:
- `googleapis` — library resmi Google untuk Gmail API
- `@modelcontextprotocol/sdk` — SDK MCP untuk OpenClaw

---

### Step 2 — Isi Kredensial di `openclaw.json`

Buka `openclaw.json` dan ganti 3 nilai berikut:

```json
"DEEPSEEK_API_KEY": "sk-GANTI_DENGAN_API_KEY_DEEPSEEK_KAMU"
"GMAIL_CLIENT_ID": "GANTI_DENGAN_CLIENT_ID_GOOGLE_KAMU"
"GMAIL_CLIENT_SECRET": "GANTI_DENGAN_CLIENT_SECRET_GOOGLE_KAMU"
```

#### Cara dapat DeepSeek API Key:
1. Buka https://platform.deepseek.com
2. Login → API Keys → Create New Key
3. Copy key yang dihasilkan (mulai dengan `sk-`)

#### Cara dapat Google OAuth2 Credentials (kamu bilang sudah punya):
- Client ID & Secret dari Google Cloud Console
- Pastikan Gmail API sudah diaktifkan di project tersebut
- Pastikan scope `https://www.googleapis.com/auth/gmail.readonly` diizinkan

---

### Step 3 — Daftarkan Konfigurasi ke OpenClaw

```bash
# Copy openclaw.json ke direktori config OpenClaw
cp ~/bri-agent/openclaw.json ~/.openclaw/openclaw.json
```

> ⚠️ Jika sudah punya `~/.openclaw/openclaw.json` sebelumnya, merge secara manual — jangan timpa langsung.

---

### Step 4 — Otorisasi Gmail (Hanya Sekali)

Jalankan MCP server secara manual untuk login Gmail pertama kali:

```bash
cd ~/bri-agent
GMAIL_CLIENT_ID="Client_ID_kamu" \
GMAIL_CLIENT_SECRET="Client_Secret_kamu" \
node tools/gmail-mcp-server.js
```

Terminal akan menampilkan URL seperti:
```
Buka URL ini di browser:
https://accounts.google.com/o/oauth2/auth?...
```

1. Buka URL tersebut di browser
2. Login dengan akun Gmail yang berisi email BRI
3. Izinkan akses read-only
4. Copy kode yang diberikan Google
5. Paste kode ke terminal, tekan Enter

Token akan tersimpan otomatis di `~/.openclaw/gmail-token.json`.
Setelah ini kamu **tidak perlu login lagi** — token di-refresh otomatis.

---

### Step 5 — Jalankan Agent BRI di OpenClaw

```bash
# Pindah ke folder project
cd ~/bri-agent

# Mulai sesi dengan agent BRI
openclaw --agent bri-analyst
```

Atau langsung dengan perintah:

```bash
openclaw --agent bri-analyst "Tampilkan ringkasan pengeluaran bulan Mei 2026"
```

---

## 💬 Contoh Perintah ke Agent

Setelah agent aktif, kamu bisa bertanya:

```
# Ringkasan bulan ini
Berapa total pengeluaran dan pemasukan bulan ini?

# Ringkasan bulan tertentu
Tampilkan ringkasan transaksi bulan April 2026

# Ringkasan hari ini
Transaksi hari ini apa saja?

# Analisis mingguan
Ringkasan minggu lalu dong

# Pertanyaan spesifik
Aku transfer ke siapa saja bulan Mei?
Hari apa aku paling banyak keluar uang bulan April?
Berapa total QRIS bulan ini?
```

---

## 🔧 Konfigurasi Filter Email BRI

Filter default di `openclaw.json`:
```
from:bri@bri.co.id OR from:notifikasi@bri.co.id OR subject:mutasi OR subject:transaksi BRI
```

Jika email BRI kamu datang dari alamat berbeda, ubah `BRI_EMAIL_FILTER` di `openclaw.json`:

```json
"BRI_EMAIL_FILTER": "from:ALAMAT_EMAIL_BRI_KAMU OR subject:KATA_KUNCI"
```

Cara cek: buka Gmail → cari email BRI → lihat alamat pengirimnya.

---

## 🐛 Troubleshooting

### Error: Token tidak valid / expired
```bash
rm ~/.openclaw/gmail-token.json
# Ulangi Step 4
```

### Error: MCP server tidak ditemukan
```bash
# Pastikan path di openclaw.json sudah absolut
# Ubah "args": ["tools/gmail-mcp-server.js"] menjadi:
"args": ["/Users/NAMA_KAMU/bri-agent/tools/gmail-mcp-server.js"]
```

### Error: DeepSeek API key invalid
```bash
openclaw doctor
# Cek apakah key sudah benar di config
```

### Email BRI tidak ditemukan
- Cek filter email di `BRI_EMAIL_FILTER`
- Test filter langsung di Gmail search bar
- Pastikan email BRI tidak masuk folder Spam

---

## 📊 Model DeepSeek yang Digunakan

| Model | Kegunaan | Konteks |
|-------|----------|---------|
| `deepseek-chat` (V4) | Analisis & parsing transaksi | 128K token |

**Kenapa deepseek-chat?**
- Murah: $0.27/1M token input, $1.10/1M token output
- Cepat untuk tugas analisis teks terstruktur
- Konteks 128K cukup untuk ratusan email transaksi sekaligus

---

## 🔒 Keamanan

- Token Gmail disimpan **lokal** di `~/.openclaw/gmail-token.json`
- Scope Gmail hanya **read-only** — agent tidak bisa kirim/hapus email
- API key DeepSeek tersimpan di `openclaw.json` — jangan commit file ini ke Git
- Tambahkan ke `.gitignore`:
  ```
  openclaw.json
  ~/.openclaw/gmail-token.json
  ```
