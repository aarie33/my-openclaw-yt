#!/usr/bin/env node
/**
 * Simple script to fetch BRI emails from Gmail and output transaction data.
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GMAIL_REDIRECT_URI || "http://localhost";
const TOKEN_PATH    = process.env.GMAIL_TOKEN_PATH || path.join(process.env.HOME, ".openclaw", "gmail-token.json");
const BRI_FILTER    = process.env.BRI_EMAIL_FILTER || "from:bri@bri.co.id OR subject:BRI mutasi";

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function authorize() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error("❌ Token file tidak ditemukan. Jalankan MCP server dulu untuk OAuth.");
    process.exit(1);
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);

  // Auto-refresh if expired
  if (token.expiry_date && token.expiry_date < Date.now()) {
    console.error("⏳ Token expired, refreshing...");
    const { credentials } = await oAuth2Client.refreshAccessToken();
    oAuth2Client.setCredentials(credentials);
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
    console.error("✅ Token refreshed!");
  }
}

function extractBody(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf8");
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === "text/plain");
    if (plain) return extractBody(plain);
    return payload.parts.map(p => extractBody(p)).join("\n");
  }
  return "";
}

async function fetchEmails(after, before, maxResults = 100) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  let query = BRI_FILTER;
  if (after)  query += ` after:${after}`;
  if (before) query += ` before:${before}`;

  console.error(`🔍 Query: ${query}`);

  const listRes = await gmail.users.messages.list({
    userId: "me", q: query, maxResults,
  });

  const messages = listRes.data.messages || [];
  console.error(`📧 Found ${messages.length} emails`);

  const emails = [];
  for (const m of messages) {
    const res = await gmail.users.messages.get({ userId: "me", id: m.id, format: "full" });
    const msg = res.data;
    const headers = msg.payload.headers || [];
    const subject = headers.find(h => h.name === "Subject")?.value || "";
    const from    = headers.find(h => h.name === "From")?.value    || "";
    const date    = headers.find(h => h.name === "Date")?.value    || "";
    const body    = extractBody(msg.payload);

    emails.push({ id: m.id, subject, from, date, body });
  }
  return emails;
}

// ── Parse BRI transaction from email body ──
function parseTransactions(emails) {
  const txns = [];
  const patterns = [
    // "Transaksi Debit/Kredit" pattern
    /(?:Transaksi\s+(Debit|Kredit)[\s\S]*?Tanggal\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})[\s\S]*?Keterangan\s*:?\s*(.+?)[\s\S]*?Jumlah\s*:?\s*Rp?\s*([\d.,]+)[\s\S]*?Saldo\s*:?\s*Rp?\s*([\d.,]+))/gi,
    // Simpler: nominal + description patterns
    /(?:DEBIT|KREDIT)[\s\S]{0,50}?Rp\s*([\d.,]+)/gi,
    // Common BRI SMS/email format
    /(?:Pembelian|Transfer|Tar Tunai|QRIS|DANA|TOP UP|Payment|Setoran|Tagihan)[^Rp]*Rp\s*([\d.,]+)/gi,
  ];

  for (const email of emails) {
    const body = email.body;

    // Try first pattern (structured email)
    const matches = [...body.matchAll(patterns[0])];
    for (const m of matches) {
      const jenis = m[1].toLowerCase() === "debit" ? "DEBIT" : "KREDIT";
      let tgl = m[2].replace(/\//g, "-");
      // Normalize date
      const parts = tgl.split("-");
      if (parts.length === 3) {
        if (parts[2].length === 2) parts[2] = "20" + parts[2];
        tgl = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
      }
      const jumlah = parseFloat(m[4].replace(/\./g, "").replace(/,/g, ""));
      const saldo  = parseFloat(m[5].replace(/\./g, "").replace(/,/g, ""));
      txns.push({ tanggal: tgl, jenis, keterangan: m[3].trim(), jumlah, saldo_akhir: saldo });
    }
  }
  return txns;
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const after  = args[0] || null;   // YYYY/MM/DD
  const before = args[1] || null;   // YYYY/MM/DD

  // Read credentials from ~/.openclaw/openclaw.json
  const configPath = path.join(process.env.HOME, ".openclaw", "openclaw.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.env) {
      if (!process.env.GMAIL_CLIENT_ID) process.env.GMAIL_CLIENT_ID = config.env.GMAIL_CLIENT_ID;
      if (!process.env.GMAIL_CLIENT_SECRET) process.env.GMAIL_CLIENT_SECRET = config.env.GMAIL_CLIENT_SECRET;
    }
  }

  await authorize();

  const emails = await fetchEmails(after, before);
  const txns = parseTransactions(emails);

  // Output parsed transactions as JSON
  const result = {
    summary: {
      total_emails: emails.length,
      total_transactions: txns.length,
      period: { after, before },
    },
    transactions: txns,
    emails: emails.map(e => ({
      id: e.id, subject: e.subject, from: e.from, date: e.date,
      body_preview: e.body.substring(0, 500),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
