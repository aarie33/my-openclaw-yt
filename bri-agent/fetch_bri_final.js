#!/usr/bin/env node
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(process.env.HOME, '.openclaw', 'gmail-token.json');
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const MONTH_MAP = {
  'jan': '01', 'january': '01', 'januari': '01',
  'feb': '02', 'february': '02', 'februari': '02',
  'mar': '03', 'march': '03', 'maret': '03',
  'apr': '04', 'april': '04',
  'may': '05', 'mei': '05',
  'jun': '06', 'june': '06', 'juni': '06',
  'jul': '07', 'july': '07', 'juli': '07',
  'aug': '08', 'august': '08', 'agustus': '08',
  'sep': '09', 'september': '09',
  'oct': '10', 'oktober': '10', 'okt': '10',
  'nov': '11', 'november': '11', 'nopember': '11',
  'dec': '12', 'desember': '12', 'des': '12'
};

function getRawHtml(payload) {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf8');
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html) return getRawHtml(html);
    return getRawHtml(payload.parts[0]);
  }
  return '';
}

function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = MONTH_MAP[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

function extractAmount(str) {
  if (!str) return 0;
  const m = str.replace(/\./g, '').match(/Rp?\s*([\d.,]+)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) || 0 : 0;
}

function extractTextOnly(html) {
  const blocks = [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    /<br\s*\/?>/gi,
    /<\/td>/gi,
    /<\/tr>/gi,
    /<\/p>/gi,
    /<\/div>/gi,
  ];
  let text = html;
  for (const re of blocks) { text = text.replace(re, '\n'); }
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractFields(html) {
  const fields = {};

  // Total Transaksi header (QRIS, BRIVA formats) - value in div after
  const totalMatch = html.match(/Total Transaksi[\s\S]{0,30}?(?:Rp)?\s*([\d.,]+)/i);
  if (totalMatch) fields.total_transaksi = extractAmount('Rp' + totalMatch[1]);

  // Try multiple HTML table patterns: <th>label</th><td>val>, <td>label</td><th>val>, <td>label</td><td>val>
  const patterns = [
    /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<td[^>]*>([\s\S]*?)<\/td>\s*<th[^>]*>([\s\S]*?)<\/th>/gi,
    /<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  ];

  for (const pattern of patterns) {
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(html)) !== null) {
      const label = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      let value = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (label && !label.match(/^\s*$/)) {
        fields[label] = value;
      }
    }
  }

  // Also get Nama Merchant from div for QRIS
  const merchantDiv = html.match(/Nama Merchant[^<]*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (merchantDiv) fields['Nama Merchant'] = merchantDiv[1].replace(/<[^>]+>/g, '').trim();

  // Get nama tujuan from the old format
  const tujuanReg = /Nama Tujuan[\s\S]{0,200}?(?:Rp)?\s*([A-Z\s]+)/i;
  const tujuanMatch = extractTextOnly(html).match(/Nama Tujuan\s*\n\s*([^\n]+)/i);
  if (tujuanMatch) fields['Nama Tujuan'] = tujuanMatch[1].trim();

  return fields;
}

function categorize(subject, keterangan) {
  const s = subject.toLowerCase();
  const k = (keterangan || '').toLowerCase();
  if (s.match(/qris/)) {
    if (k.match(/makan|minum|kopi|resto|cafe|warung|soup|buah|juice|teboo|batagor|risoles|moonyo|jago/i)) return 'makan_minum';
    return 'qris';
  }
  if (s.match(/transfer|pemindahan/)) {
    if (k.match(/bsi|bca|mandiri|btn|bni|danamon|permata|cimb|maybank|jenius|gojek|gopay|ovo|dana|shopeepay|linkaja/i)) return 'transfer';
    return 'transfer';
  }
  if (s.match(/briva|tagihan|pembayaran\s+(berhasil|listrik|air|telepon|internet|kartu|bpjs)/i)) return 'tagihan';
  if (s.match(/belanja|pembelian/i)) return 'belanja';
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
  console.error('Total:', msgs.length);

  const txns = [];
  for (const m of msgs) {
    const r = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const hh = r.data.payload?.headers || [];
    const subject = hh.find(x => x.name === 'Subject')?.value || '';
    const emailDate = hh.find(x => x.name === 'Date')?.value || '';

    const html = getRawHtml(r.data.payload);
    const fields = extractFields(html);
    const text = extractTextOnly(html);

    // --- Tanggal ---
    let tanggal = parseDate(fields['Tanggal Transaksi']) ||
                  parseDate(fields['Tanggal']) ||
                  null;
    // Fallback: parse from text directly (old format emails)
    if (!tanggal) {
      const dateMatch = text.match(/Tanggal[\s\S]{0,5}?(\d{1,2}\s+\w+\s+\d{4})/i);
      if (dateMatch) tanggal = parseDate(dateMatch[1]);
    }

    // --- Jumlah ---
    let jumlah = 0;
    // Try total_transaksi from div first
    if (fields.total_transaksi) jumlah = fields.total_transaksi;
    else {
      // Try Nominal field
      const nominalStr = fields['Nominal'];
      if (nominalStr) jumlah = extractAmount(nominalStr);
    }
    // If still zero, try finding Rp amount in text
    if (jumlah === 0) {
      const amounts = [...text.matchAll(/Rp\s*([\d.,]+)/g)].map(m =>
        parseFloat(m[1].replace(/\./g, '').replace(/,/g, ''))
      ).filter(n => !isNaN(n) && n > 1000);
      if (amounts.length > 0) jumlah = amounts[0];
    }

    // --- Biaya Admin ---
    let biaya = 0;
    const biayaStr = fields['Biaya Admin'];
    if (biayaStr) biaya = extractAmount(biayaStr);

    // --- Keterangan ---
    let keterangan = fields['Nama Merchant'] ||
                     fields['Nama Tujuan'] ||
                     fields['Nama Penerima'] || '';

    // Clean up keterangan
    if (keterangan) {
      keterangan = keterangan.replace(/\s+/g, ' ').trim();
      // Remove account numbers
      keterangan = keterangan.replace(/\d{4}\s*\*+\s*\d{3,4}/g, '').trim();
    }

    // For transfer, get tujuan from text
    if (!keterangan && subject.match(/Pemindahan|Transfer/i)) {
      const tMatch = text.match(/Nama Tujuan\s*\n\s*([A-Z\s]+)/i);
      if (tMatch) keterangan = tMatch[1].trim();
      const bMatch = text.match(/Bank Tujuan\s*\n\s*([A-Z\s]+)/i);
      if (bMatch) keterangan = (keterangan ? keterangan + ' - ' : '') + bMatch[1].trim();
    }

    const kategori = categorize(subject, keterangan);
    const jenis = 'DEBIT';

    txns.push({
      tanggal: tanggal || '?',
      jenis,
      jumlah: Math.round(jumlah),
      biaya_admin: Math.round(biaya),
      keterangan: keterangan || subject,
      kategori,
      subject,
      email_date: emailDate,
    });
  }

  // Sort by date
  txns.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
    return a.email_date.localeCompare(b.email_date);
  });

  // Summary
  let totalPengeluaran = 0;
  const kategoriTotals = {};
  const perHari = {};
  for (const t of txns) {
    totalPengeluaran += t.jumlah;
    kategoriTotals[t.kategori] = (kategoriTotals[t.kategori] || 0) + t.jumlah;
    const d = t.tanggal;
    if (!perHari[d]) perHari[d] = { tanggal: d, items: [], total: 0 };
    perHari[d].items.push(t);
    perHari[d].total += t.jumlah;
  }

  // Format output with beautiful summary
  const output = {
    ringkasan: {
      periode: `${after.replace(/\//g, '-')} s/d ${before.replace(/\//g, '-')}`,
      total_transaksi: txns.length,
      total_pengeluaran: totalPengeluaran,
      per_kategori: kategoriTotals,
    },
    per_hari: Object.values(perHari).sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    transaksi: txns,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
