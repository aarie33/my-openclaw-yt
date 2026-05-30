#!/usr/bin/env node
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(process.env.HOME, '.openclaw', 'gmail-token.json');
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const after = process.argv[2] || null;
const before = process.argv[3] || null;
const maxResults = parseInt(process.argv[4] || '50');

async function main() {
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  let query = 'from:bri@bri.co.id OR from:notifikasi@bri.co.id OR subject:mutasi OR subject:transaksi BRI';
  if (after) query += ' after:' + after;
  if (before) query += ' before:' + before;

  console.error('📧 Query:', query);

  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  const msgs = res.data.messages || [];
  console.error('📧 Total emails:', msgs.length);

  const results = [];
  for (const m of msgs) {
    const r = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const headers = r.data.payload.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';

    function extractBody(payload) {
      if (!payload) return '';
      if (payload.mimeType === 'text/plain' && payload.body?.data)
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
      if (payload.mimeType === 'text/html' && payload.body?.data) {
        const html = Buffer.from(payload.body.data, 'base64').toString('utf8');
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (payload.parts) {
        const plain = payload.parts.find(p => p.mimeType === 'text/plain');
        if (plain) return extractBody(plain);
        return payload.parts.map(p => extractBody(p)).join('\n');
      }
      return '';
    }
    const body = extractBody(r.data.payload);

    // Try to find transactions in the body
    const transactions = [];
    
    // Pattern: Tanggal + Keterangan + Jumlah + Saldo
    const re = /(?:Transaksi\s+(Debit|Kredit)|(?:DEBIT|KREDIT))\s*[\s\S]{0,5}?Tanggal\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})[\s\S]{0,100}?Keterangan\s*:?\s*(.+?)(?:\n|$)[\s\S]{0,5}?(?:Nominal|Jumlah)\s*:?\s*Rp?\s*([\d.,\s]+)[\s\S]{0,5}?(?:Saldo|Sisa)\s*:?\s*Rp?\s*([\d.,\s]+)/gi;

    let match;
    while ((match = re.exec(body)) !== null) {
      const jenis = (match[1] || match[0]).toUpperCase().includes('KREDIT') ? 'KREDIT' : 'DEBIT';
      let tgl = match[2].replace(/\//g, '-');
      const parts = tgl.split('-');
      if (parts.length === 3) {
        parts[0] = parts[0].padStart(2, '0');
        parts[1] = parts[1].padStart(2, '0');
        if (parts[2].length === 2) parts[2] = '20' + parts[2];
        tgl = parts.join('-');
      }
      const jumlah = parseFloat((match[3] || '').replace(/\./g, '').replace(/,/g, '').trim()) || 0;
      const saldo = parseFloat((match[4] || '').replace(/\./g, '').replace(/,/g, '').trim()) || 0;
      transactions.push({
        tanggal: tgl,
        jenis,
        keterangan: (match[3] || '').trim(),
        jumlah,
        saldo_akhir: saldo
      });
    }

    results.push({
      id: m.id,
      subject,
      from,
      date,
      body_preview: body.substring(0, 300),
      transactions
    });
  }

  // Summarize
  let totalDebit = 0, totalKredit = 0;
  const allTx = [];
  for (const r of results) {
    for (const t of r.transactions) {
      allTx.push(t);
      if (t.jenis === 'DEBIT') totalDebit += t.jumlah;
      else totalKredit += t.jumlah;
    }
  }

  const output = {
    summary: {
      total_emails: msgs.length,
      total_parsed_transactions: allTx.length,
      total_pengeluaran_debit: totalDebit,
      total_pemasukan_kredit: totalKredit,
      period: { after, before }
    },
    all_transactions: allTx,
    emails: results.map(r => ({
      id: r.id,
      subject: r.subject,
      from: r.from,
      date: r.date,
      body_preview: r.body_preview,
      transactions: r.transactions
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error('❌ Error:', e.message, e.response?.data ? JSON.stringify(e.response.data) : '');
  process.exit(1);
});
