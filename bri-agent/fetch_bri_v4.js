#!/usr/bin/env node
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(process.env.HOME, '.openclaw', 'gmail-token.json');
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const MONTHS_ID = {
  'jan': '01', 'januari': '01',
  'feb': '02', 'februari': '02',
  'mar': '03', 'maret': '03',
  'apr': '04', 'april': '04',
  'mei': '05',
  'jun': '06', 'juni': '06',
  'jul': '07', 'juli': '07',
  'agt': '08', 'agustus': '08',
  'sep': '09', 'september': '09',
  'okt': '10', 'oktober': '10',
  'nov': '11', 'nopember': '11',
  'des': '12', 'desember': '12'
};

function parseIndonesianDate(str) {
  if (!str) return null;
  // Match: "01 Mei 2026" or "1 Mei 2026"
  const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = MONTHS_ID[m[2].toLowerCase()];
    const year = m[3];
    if (month) return `${year}-${month}-${day}`;
  }
  return null;
}

function extractAmount(str) {
  if (!str) return 0;
  const m = str.replace(/\./g, '').match(/([\d,]+)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) || 0 : 0;
}

function getRawHtml(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html) return getRawHtml(html);
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return getRawHtml(plain);
    return payload.parts.map(p => getRawHtml(p)).join('\n');
  }
  return '';
}

function extractFields(html) {
  // Remove script and style content
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  
  let tanggal = null;
  let nominal = 0;
  let total = 0;
  let keterangan = '';
  let sumberDana = '';
  let tujuan = '';
  let jenisTransaksi = '';
  let biayaAdmin = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    
    // Tanggal: "01 Mei 2026, 15:36:17 WIB"
    if (l.match(/^Tanggal$/i) && i + 1 < lines.length) {
      const parsed = parseIndonesianDate(lines[i + 1]);
      if (parsed) tanggal = parsed;
    }
    
    // Alternative: inline "Tanggal 01 Mei 2026"
    const inlineDate = l.match(/Tanggal\s+(\d{1,2}\s+\w+\s+\d{4})/i);
    if (inlineDate) {
      const parsed = parseIndonesianDate(inlineDate[1]);
      if (parsed) tanggal = parsed;
    }
    
    // Nominal
    if (l.match(/^Nominal$/i) && i + 1 < lines.length) {
      nominal = extractAmount(lines[i + 1]);
    }
    
    // Total (includes biaya admin)
    if (l.match(/^Total$/i) && i + 1 < lines.length) {
      total = extractAmount(lines[i + 1]);
    }
    
    // Biaya Admin
    if (l.match(/^Biaya Admin/i) && i + 1 < lines.length) {
      biayaAdmin = extractAmount(lines[i + 1]);
    }
    
    // Keterangan / Sumber Dana
    if (l.match(/^Sumber Dana$/i) && i + 1 < lines.length) {
      sumberDana = lines[i + 1];
    }
    
    // Tujuan
    if (l.match(/^Nama (Tujuan|Penerima)/i) && i + 1 < lines.length) {
      tujuan = lines[i + 1];
    }
    
    // Jenis Transaksi
    if (l.match(/^Jenis Transaksi$/i) && i + 1 < lines.length) {
      jenisTransaksi = lines[i + 1];
    }
    
    // Merchant for QRIS
    if (l.match(/^Merchant$/i) && i + 1 < lines.length) {
      tujuan = lines[i + 1];
    }
  }

  // If total not found, use nominal
  const amount = total > 0 ? total : nominal;

  return { tanggal, amount, nominal, total, biayaAdmin, sumberDana, tujuan, jenisTransaksi };
}

function categorize(subject, fields) {
  const s = subject.toLowerCase();
  const t = (fields.tujuan || '').toLowerCase();
  const j = (fields.jenisTransaksi || '').toLowerCase();
  
  if (s.match(/transfer|pemindahan/)) {
    if (j.match(/BI-FAST|SKN|RTGS/i) || t) return 'transfer';
    return 'transfer';
  }
  if (s.match(/qris/)) {
    if (t.match(/soup|buah|juice|makan|minum|kopi|resto|cafe|warung/i)) return 'makanan_minuman';
    return 'qris';
  }
  if (s.match(/briva/i)) return 'tagihan';
  if (s.match(/pembayaran|bayar/i)) return 'pembayaran';
  if (s.match(/pembelian|belanja/i)) return 'belanja';
  return 'lainnya';
}

async function main() {
  const after = process.argv[2] || '2026/05/01';
  const before = process.argv[3] || '2026/05/31';
  
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const query = `from:BankBRI@bri.co.id after:${after} before:${before}`;

  console.error('Query:', query);
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100 });
  const msgs = res.data.messages || [];
  console.error('Total emails:', msgs.length);

  const txns = [];
  for (const m of msgs) {
    const r = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const h = r.data.payload?.headers || [];
    const subject = h.find(x => x.name === 'Subject')?.value || '';
    const date = h.find(x => x.name === 'Date')?.value || '';
    
    const html = getRawHtml(r.data.payload);
    const fields = extractFields(html);
    const kategori = categorize(subject, fields);
    
    txns.push({
      tanggal: fields.tanggal || 'unknown',
      jenis: 'DEBIT',
      jumlah: fields.amount,
      nominal: fields.nominal,
      total: fields.total,
      biaya_admin: fields.biayaAdmin,
      keterangan: fields.tujuan || fields.sumberDana || subject,
      jenis_transaksi: fields.jenisTransaksi,
      sumber_dana: fields.sumberDana,
      kategori,
      subject,
      date,
      email_id: m.id
    });
  }

  // Sort by date, then by email date
  txns.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
    return a.date.localeCompare(b.date);
  });

  // Calculate totals
  let totalPengeluaran = 0;
  const kategoriTotals = {};
  const perHari = {};

  for (const t of txns) {
    totalPengeluaran += t.jumlah;
    const d = t.tanggal;
    if (!perHari[d]) perHari[d] = { date: d, transaksi: [], total: 0 };
    perHari[d].transaksi.push(t);
    perHari[d].total += t.jumlah;
    
    kategoriTotals[t.kategori] = (kategoriTotals[t.kategori] || 0) + t.jumlah;
  }

  const output = {
    ringkasan: {
      periode: `${after.replace(/\//g, '-')} s/d ${before.replace(/\//g, '-')}`,
      total_transaksi: txns.length,
      total_pengeluaran: totalPengeluaran,
      per_kategori: kategoriTotals
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
