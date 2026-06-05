// index.ts
// Agent Invoice — OpenClaw Tool Plugin
// Entry point utama: mendaftarkan semua tools ke OpenClaw runtime

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

import { scanInvoiceEmails } from "./tools/scan-invoice-emails.js";
import { recordToSheets } from "./tools/record-to-sheets.js";
import { getExpenseSummary } from "./tools/get-expense-summary.js";

export default definePluginEntry({
  id: "agent-invoice",
  name: "Agent Invoice — Kuitansi & Nota Otomatis",
  description:
    "Tools untuk membaca email kuitansi Gmail dan mencatatnya ke Google Sheets.",

  register(api) {
    // ── Tool 1: Scan email kuitansi dari Gmail ──────────────────────────────
    api.registerTool({
      name: "scan_invoice_emails",
      description:
        "Scan inbox Gmail, temukan email kuitansi/nota/invoice (Grab, Gojek, Tokopedia, Shopee, PDF invoice vendor), " +
        "lalu ekstrak data: tanggal, vendor, nominal, kategori, sumber. " +
        "Gunakan tool ini saat pengguna minta scan email belanja atau kuitansi.",
      parameters: Type.Object({
        since_hours: Type.Optional(
          Type.Number({
            description:
              "Scan email N jam ke belakang. Default 24 jam. Gunakan 168 untuk 7 hari.",
            minimum: 1,
            maximum: 720,
          })
        ),
        max_results: Type.Optional(
          Type.Number({
            description: "Maksimum jumlah email yang di-scan. Default 50.",
            minimum: 1,
            maximum: 200,
          })
        ),
      }),
      async execute(_id, params) {
        return await scanInvoiceEmails({
          sinceHours: params.since_hours ?? 24,
          maxResults: params.max_results ?? 50,
        });
      },
    });

    // ── Tool 2: Catat data kuitansi ke Google Sheets ────────────────────────
    api.registerTool({
      name: "record_to_sheets",
      description:
        "Catat satu atau beberapa data pengeluaran ke Google Sheets. " +
        "Gunakan setelah scan_invoice_emails untuk menyimpan hasilnya. " +
        "Sheet otomatis dibuat per tahun dengan format kolom: Tanggal | Vendor | Nominal | Kategori | Sumber | Bulan | Catatan.",
      parameters: Type.Object({
        spreadsheet_id: Type.String({
          description: "ID Google Spreadsheet tujuan (dari URL sheets kamu).",
        }),
        records: Type.Array(
          Type.Object({
            tanggal: Type.String({
              description: "Tanggal transaksi format YYYY-MM-DD",
            }),
            vendor: Type.String({ description: "Nama vendor/toko/platform" }),
            nominal: Type.Number({ description: "Nominal dalam Rupiah (angka bulat)" }),
            kategori: Type.String({
              description:
                "Kategori pengeluaran: Makanan & Minuman | Transportasi | Belanja Online | " +
                "Tagihan & Utilitas | Komunikasi | Akomodasi & Travel | Kesehatan | " +
                "Pendidikan | Hiburan | Perlengkapan Kantor | Bahan Baku | Jasa & Layanan | Lainnya",
            }),
            sumber: Type.String({ description: "Platform asal: Tokopedia, Grab, dll." }),
            catatan: Type.Optional(Type.String({ description: "Keterangan tambahan" })),
            email_id: Type.Optional(Type.String({ description: "ID email Gmail untuk deduplication" })),
          })
        ),
      }),
      async execute(_id, params) {
        return await recordToSheets({
          spreadsheetId: params.spreadsheet_id,
          records: params.records,
        });
      },
    });

    // ── Tool 3: Lihat ringkasan pengeluaran dari Sheets ─────────────────────
    api.registerTool(
      {
        name: "get_expense_summary",
        description:
          "Ambil ringkasan pengeluaran dari Google Sheets: total per bulan, per kategori, atau keduanya. " +
          "Gunakan saat pengguna tanya 'berapa pengeluaran bulan ini' atau 'kategori terbesar apa'.",
        parameters: Type.Object({
          spreadsheet_id: Type.String({
            description: "ID Google Spreadsheet yang mau diringkas.",
          }),
          bulan: Type.Optional(
            Type.String({
              description:
                "Filter bulan tertentu (Januari–Desember). Kosongkan untuk semua bulan tahun ini.",
            })
          ),
          group_by: Type.Optional(
            Type.Union([Type.Literal("kategori"), Type.Literal("bulan"), Type.Literal("vendor")], {
              description: "Kelompokkan hasil berdasarkan: kategori | bulan | vendor. Default: kategori.",
            })
          ),
        }),
        async execute(_id, params) {
          return await getExpenseSummary({
            spreadsheetId: params.spreadsheet_id,
            bulan: params.bulan,
            groupBy: params.group_by ?? "kategori",
          });
        },
      },
      { optional: true } // Opsional — aktifkan di tools.allow config OpenClaw
    );
  },
});
