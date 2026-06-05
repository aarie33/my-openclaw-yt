// tools/get-expense-summary.ts
// Tool: get_expense_summary
// Baca data dari Google Sheets dan kembalikan ringkasan pengeluaran

import { getSheetsClient } from "./gmail-client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SummaryParams {
  spreadsheetId: string;
  bulan?: string;
  groupBy: "kategori" | "bulan" | "vendor";
}

interface SheetRow {
  tanggal: string;
  vendor: string;
  nominal: number;
  kategori: string;
  sumber: string;
  bulan: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getExpenseSummary(params: SummaryParams) {
  const sheets = await getSheetsClient();
  const year = new Date().getFullYear().toString();

  // Ambil semua data dari sheet tahun ini
  let allData: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: params.spreadsheetId,
      range: `${year}!A2:I`, // Skip header row
    });
    allData = res.data.values ?? [];
  } catch {
    return {
      content: [
        {
          type: "text",
          text: `❌ Gagal membaca sheet "${year}". Pastikan spreadsheet_id benar dan sudah ada datanya.`,
        },
      ],
    };
  }

  if (allData.length === 0) {
    return {
      content: [{ type: "text", text: `📊 Belum ada data pengeluaran di sheet ${year}.` }],
    };
  }

  // Parse rows
  let rows: SheetRow[] = allData
    .map((r) => ({
      tanggal: r[0] ?? "",
      vendor: r[1] ?? "",
      nominal: parseNominal(r[2]),
      kategori: r[3] ?? "Lainnya",
      sumber: r[4] ?? "",
      bulan: r[5] ?? "",
    }))
    .filter((r) => r.nominal > 0);

  // Filter per bulan jika diminta
  if (params.bulan) {
    rows = rows.filter(
      (r) => r.bulan.toLowerCase() === params.bulan!.toLowerCase()
    );
    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `📊 Tidak ada data pengeluaran untuk bulan ${params.bulan}.`,
          },
        ],
      };
    }
  }

  // Hitung total keseluruhan
  const grandTotal = rows.reduce((sum, r) => sum + r.nominal, 0);

  // Group & sum berdasarkan pilihan
  const grouped = groupAndSum(rows, params.groupBy);

  // Sort by total descending
  const sorted = Object.entries(grouped)
    .sort(([, a], [, b]) => b - a)
    .map(([key, total]) => ({
      label: key,
      total,
      persen: ((total / grandTotal) * 100).toFixed(1),
    }));

  // Format output teks
  const filterLabel = params.bulan ? `bulan ${params.bulan}` : `tahun ${year}`;
  const groupLabel = { kategori: "Kategori", bulan: "Bulan", vendor: "Vendor" }[
    params.groupBy
  ];

  let output = `📊 Ringkasan Pengeluaran — ${filterLabel}\n`;
  output += `${"─".repeat(45)}\n`;
  output += `💰 Total: Rp${grandTotal.toLocaleString("id-ID")}\n`;
  output += `📝 Jumlah Transaksi: ${rows.length}\n\n`;
  output += `Breakdown per ${groupLabel}:\n`;

  for (const item of sorted) {
    const bar = "█".repeat(Math.round(parseFloat(item.persen) / 5));
    output += `  ${item.label.padEnd(24)} Rp${item.total.toLocaleString("id-ID").padStart(12)} (${item.persen}%) ${bar}\n`;
  }

  return {
    content: [{ type: "text", text: output }],
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function groupAndSum(
  rows: SheetRow[],
  by: "kategori" | "bulan" | "vendor"
): Record<string, number> {
  const keyMap: Record<typeof by, keyof SheetRow> = {
    kategori: "kategori",
    bulan: "bulan",
    vendor: "vendor",
  };
  const key = keyMap[by];
  return rows.reduce<Record<string, number>>((acc, row) => {
    const k = (row[key] as string) || "Tidak Diketahui";
    acc[k] = (acc[k] ?? 0) + row.nominal;
    return acc;
  }, {});
}

function parseNominal(raw: string | undefined): number {
  if (!raw) return 0;
  // Handle format "Rp50.000" atau "50000"
  const cleaned = String(raw).replace(/[^0-9]/g, "");
  return parseInt(cleaned, 10) || 0;
}
