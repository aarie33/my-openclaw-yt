// tools/record-to-sheets.ts
// Tool: record_to_sheets
// Tulis data pengeluaran ke Google Sheets, auto-buat sheet per tahun

import { getSheetsClient } from "./gmail-client.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADERS = [
  "Tanggal",
  "Vendor",
  "Nominal (Rp)",
  "Kategori",
  "Sumber",
  "Bulan",
  "Catatan",
  "Email ID",
  "Dicatat Pada",
];

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Record {
  tanggal: string;
  vendor: string;
  nominal: number;
  kategori: string;
  sumber: string;
  catatan?: string;
  email_id?: string;
}

interface RecordParams {
  spreadsheetId: string;
  records: Record[];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function recordToSheets(params: RecordParams) {
  const sheets = await getSheetsClient();
  const year = new Date().getFullYear().toString();

  // Pastikan sheet tahun ini sudah ada
  const sheetId = await ensureYearSheet(sheets, params.spreadsheetId, year);

  // Cek email ID yang sudah dicatat (deduplication)
  const existingEmailIds = await getExistingEmailIds(sheets, params.spreadsheetId, year);

  let recorded = 0;
  let skipped = 0;
  const results: string[] = [];

  for (const rec of params.records) {
    // Skip jika email ini sudah pernah dicatat
    if (rec.email_id && existingEmailIds.has(rec.email_id)) {
      skipped++;
      results.push(`⏭️  Duplikat dilewati: ${rec.vendor}`);
      continue;
    }

    const bulan = getBulan(rec.tanggal);
    const now = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const row = [
      rec.tanggal,
      rec.vendor,
      rec.nominal,
      rec.kategori,
      rec.sumber,
      bulan,
      rec.catatan ?? "",
      rec.email_id ?? "",
      now,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: params.spreadsheetId,
      range: `${year}!A:I`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    recorded++;
    results.push(`✅ ${rec.vendor} | Rp${rec.nominal.toLocaleString("id-ID")} | ${bulan}`);

    // Brief pause untuk rate limit Sheets API
    await sleep(200);
  }

  return {
    content: [
      {
        type: "text",
        text:
          `📊 Selesai mencatat ke Google Sheets (tab: ${year})\n\n` +
          `✅ Berhasil dicatat : ${recorded}\n` +
          `⏭️  Dilewati (duplikat): ${skipped}\n\n` +
          results.join("\n"),
      },
    ],
  };
}

// ── Sheet management ──────────────────────────────────────────────────────────

async function ensureYearSheet(
  sheets: any,
  spreadsheetId: string,
  year: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const existing = meta.data.sheets.find(
    (s: any) => s.properties.title === year
  );
  if (existing) return existing.properties.sheetId;

  // Buat tab baru
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: year,
              gridProperties: { rowCount: 2000, columnCount: HEADERS.length },
            },
          },
        },
      ],
    },
  });

  const newSheetId =
    addRes.data.replies[0].addSheet.properties.sheetId;

  // Tulis header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${year}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS] },
  });

  // Format header: biru, bold, freeze
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.13, green: 0.35, blue: 0.70 },
                textFormat: {
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                  bold: true,
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          // Format kolom Nominal sebagai Rupiah
          repeatCell: {
            range: {
              sheetId: newSheetId,
              startRowIndex: 1,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: "NUMBER", pattern: '"Rp"#,##0' },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: newSheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: HEADERS.length,
            },
          },
        },
      ],
    },
  });

  return newSheetId;
}

async function getExistingEmailIds(
  sheets: any,
  spreadsheetId: string,
  year: string
): Promise<Set<string>> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${year}!H:H`, // Kolom Email ID
    });
    const values: string[][] = res.data.values ?? [];
    return new Set(values.flat().filter(Boolean));
  } catch {
    return new Set();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getBulan(dateStr: string): string {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "Tidak Diketahui" : BULAN_ID[d.getMonth()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
