#!/usr/bin/env node
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(process.env.HOME, '.openclaw', 'gmail-token.json');
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

async function main() {
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const query = 'from:BankBRI@bri.co.id after:2026/05/01 before:2026/05/31';

  console.error('Query:', query);
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100 });
  const msgs = res.data.messages || [];
  console.error('Total:', msgs.length);

  function extractBody(payload) {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data)
      return Buffer.from(payload.body.data, 'base64').toString('utf8');
    if (payload.body?.data) {
      const html = Buffer.from(payload.body.data, 'base64').toString('utf8');
      return html
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n\s*\n+/g, '\n')
        .trim();
    }
    if (payload.parts) {
      const plain = payload.parts.find(p => p.mimeType === 'text/plain');
      if (plain) return extractBody(plain);
      return payload.parts.map(p => extractBody(p)).filter(Boolean).join('\n');
    }
    return '';
  }

  function parseTrans(body, subject) {
    const isDebit = !!subject.match(/Pembelian|Pembayaran|Pemindahan|QRIS|Bayar|Berhasil/i);
    let tgl = '', jumlah = 0, saldo = 0, keterangan = '';

    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dm = l.match(/(?:Tanggal|Tgl)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (dm) {
        const d = dm[1].split('/');
        const y = d[2].length === 2 ? '20' + d[2] : d[2];
        tgl = y + '-' + d[1].padStart(2, '0') + '-' + d[0].padStart(2, '0');
      }
      const am = l.match(/(?:Jumlah|Nominal|Total|Nilai)\s*:?\s*Rp?\s*([\d.,\s]+)/i);
      if (am) jumlah = parseFloat(am[1].replace(/[.\s]/g, '').replace(/,/, '')) || 0;
      const sm = l.match(/(?:Saldo|Sisa|Balance)\s*:?\s*Rp?\s*([\d.,\s]+)/i);
      if (sm) saldo = parseFloat(sm[1].replace(/[.\s]/g, '').replace(/,/, '')) || 0;
    }

    // Try to get merchant/penerima from body
    const merchantMatch = body.match(/(?:Penerima|Merchant|Untuk|Nama)\s*:?\s*(.+)/i);
    if (merchantMatch) keterangan = merchantMatch[1].trim().substring(0, 80);

    // Fallback to regex amounts
    if (!tgl || !jumlah) {
      const amounts = [...body.matchAll(/Rp\s*([\d.,]+)/g)].map(m =>
        parseFloat(m[1].replace(/[.\s]/g, '').replace(/,/, ''))
      ).filter(n => !isNaN(n));
      if (amounts.length >= 2) { jumlah = amounts[0]; saldo = amounts[amounts.length - 1]; }
      else if (amounts.length === 1) jumlah = amounts[0];
    }

    return { tanggal: tgl || 'unknown', jenis: 'DEBIT', jumlah, saldo_akhir: saldo, keterangan: keterangan || subject };
  }

  const txns = [];
  for (const m of msgs) {
    const r = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const h = r.data.payload?.headers || [];
    const subject = h.find(x => x.name === 'Subject')?.value || '';
    const from = h.find(x => x.name === 'From')?.value || '';
    const date = h.find(x => x.name === 'Date')?.value || '';
    const body = extractBody(r.data.payload);
    const tx = parseTrans(body, subject);
    txns.push({ ...tx, subject, date, email_id: m.id });
  }

  // Sort by date
  txns.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.date.localeCompare(b.date));

  let totalPengeluaran = 0;
  for (const t of txns) {
    if (t.jenis === 'DEBIT') totalPengeluaran += t.jumlah;
  }

  // Group by date
  const perHari = {};
  for (const t of txns) {
    const d = t.tanggal;
    if (!perHari[d]) perHari[d] = { date: d, transactions: [], total: 0 };
    perHari[d].transactions.push(t);
    perHari[d].total += t.jumlah;
  }

  const output = {
    ringkasan: {
      periode: '1 - 31 Mei 2026',
      total_transaksi: txns.length,
      total_pengeluaran: totalPengeluaran,
    },
    transaksi: txns,
    per_hari: Object.values(perHari).sort((a, b) => a.date.localeCompare(b.date))
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.response) console.error(JSON.stringify(e.response.data));
  process.exit(1);
});
