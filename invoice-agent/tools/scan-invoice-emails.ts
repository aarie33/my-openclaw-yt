// tools/scan-invoice-emails.ts
// Tool: scan_invoice_emails
// Fetch email kuitansi dari Gmail, parse body + attachment PDF, kembalikan data terstruktur

import * as cheerio from "cheerio";
import he from "he";
import { getGmailClient } from "./gmail-client.js";

// ── Keyword & domain filter ───────────────────────────────────────────────────

const RECEIPT_KEYWORDS = [
  "invoice", "kwitansi", "kuitansi", "nota", "struk", "bukti pembayaran",
  "bukti transaksi", "payment receipt", "order confirmation", "konfirmasi pesanan",
  "pesanan kamu", "transaksi berhasil", "pembayaran berhasil", "payment successful",
  "thank you for your order", "terima kasih telah berbelanja",
  "grab", "gojek", "tokopedia", "shopee", "bukalapak", "lazada", "blibli",
  "traveloka", "tiket.com",
];

const TRUSTED_DOMAINS = [
  "grab.com", "gojek.com", "tokopedia.com", "shopee.co.id",
  "bukalapak.com", "lazada.co.id", "blibli.com", "traveloka.com",
  "tiket.com", "pln.co.id", "telkom.co.id",
];

const SOURCE_MAP: Record<string, string> = {
  tokopedia: "Tokopedia", shopee: "Shopee", grab: "Grab",
  gojek: "Gojek", bukalapak: "Bukalapak", lazada: "Lazada",
  blibli: "Blibli", traveloka: "Traveloka", tiket: "Tiket.com",
  pln: "PLN", telkom: "Telkom",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScanParams {
  sinceHours: number;
  maxResults: number;
}

interface ParsedEmail {
  emailId: string;
  subject: string;
  from: string;
  date: string;
  bodyText: string;
  hasPdfAttachment: boolean;
  pdfText: string;
  detectedSource: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function scanInvoiceEmails(params: ScanParams) {
  const gmail = await getGmailClient();

  const since = new Date(Date.now() - params.sinceHours * 60 * 60 * 1000);
  const afterDate = toGmailDate(since);
  const keywordQuery = RECEIPT_KEYWORDS.slice(0, 12)
    .map((k) => `"${k}"`)
    .join(" OR ");
  const query = `in:INBOX after:${afterDate} (${keywordQuery}) -label:invoice-processed`;

  // Fetch message list
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: params.maxResults,
  });

  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `📭 Tidak ada email kuitansi baru dalam ${params.sinceHours} jam terakhir.`,
        },
      ],
    };
  }

  // Fetch detail in batches of 10
  const parsed: ParsedEmail[] = [];
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    const details = await Promise.allSettled(
      batch.map((m) => parseEmailDetail(gmail, m.id!))
    );
    for (const d of details) {
      if (d.status === "fulfilled" && d.value) parsed.push(d.value);
    }
  }

  if (parsed.length === 0) {
    return {
      content: [{ type: "text", text: "📭 Tidak ada email kuitansi valid ditemukan." }],
    };
  }

  // Return structured data — OpenClaw/LLM akan proses lebih lanjut
  const summary = parsed.map((e) => ({
    email_id: e.emailId,
    subject: e.subject,
    from: e.from,
    date: e.date,
    detected_source: e.detectedSource,
    has_pdf: e.hasPdfAttachment,
    // Potong body agar tidak membengkakkan context
    body_preview: e.bodyText.substring(0, 1500),
    pdf_text_preview: e.pdfText ? e.pdfText.substring(0, 1000) : null,
  }));

  return {
    content: [
      {
        type: "text",
        text:
          `✅ Ditemukan ${parsed.length} email kuitansi.\n\n` +
          `Data email (gunakan tool record_to_sheets setelah mengekstrak info pengeluaran):\n\n` +
          JSON.stringify(summary, null, 2),
      },
    ],
  };
}

// ── Email parsing helpers ─────────────────────────────────────────────────────

async function parseEmailDetail(
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  messageId: string
): Promise<ParsedEmail | null> {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const headers = msg.payload?.headers ?? [];
  const subject = getHeader(headers, "Subject") ?? "(No Subject)";
  const from = getHeader(headers, "From") ?? "";
  const dateStr = getHeader(headers, "Date") ?? "";
  const date = parseDate(dateStr);

  if (!isReceiptEmail(from, subject)) return null;

  const { bodyText, pdfText, hasPdfAttachment } = await extractContent(
    gmail,
    msg.payload!,
    messageId
  );

  return {
    emailId: messageId,
    subject,
    from,
    date,
    bodyText: cleanText(bodyText),
    hasPdfAttachment,
    pdfText: cleanText(pdfText),
    detectedSource: detectSource(from, subject),
  };
}

async function extractContent(
  gmail: any,
  part: any,
  messageId: string,
  depth = 0
): Promise<{ bodyText: string; pdfText: string; hasPdfAttachment: boolean }> {
  let bodyText = "";
  let pdfText = "";
  let hasPdfAttachment = false;

  if (!part) return { bodyText, pdfText, hasPdfAttachment };

  if (part.mimeType?.startsWith("multipart/") && part.parts) {
    for (const sub of part.parts) {
      const r = await extractContent(gmail, sub, messageId, depth + 1);
      bodyText += r.bodyText;
      pdfText += r.pdfText;
      hasPdfAttachment = hasPdfAttachment || r.hasPdfAttachment;
    }
    return { bodyText, pdfText, hasPdfAttachment };
  }

  const data = part.body?.data;

  if (part.mimeType === "text/plain" && data) {
    bodyText += decodeB64(data);
  } else if (part.mimeType === "text/html" && data) {
    bodyText += htmlToText(decodeB64(data));
  } else if (part.mimeType === "application/pdf") {
    hasPdfAttachment = true;
    const attachmentId = part.body?.attachmentId;
    if (attachmentId) {
      try {
        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });
        const buf = Buffer.from(attRes.data.data, "base64");
        // Gunakan pdf-parse untuk ekstrak teks
        const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
        const parsed = await pdfParse(buf);
        pdfText += parsed.text ?? "";
      } catch {
        // PDF gagal di-parse, lanjutkan
      }
    }
  }

  return { bodyText, pdfText, hasPdfAttachment };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function isReceiptEmail(from: string, subject: string): boolean {
  const text = `${from} ${subject}`.toLowerCase();
  if (TRUSTED_DOMAINS.some((d) => text.includes(d))) return true;
  return RECEIPT_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function detectSource(from: string, subject: string): string {
  const text = `${from} ${subject}`.toLowerCase();
  for (const [key, value] of Object.entries(SOURCE_MAP)) {
    if (text.includes(key)) return value;
  }
  return "Email";
}

function getHeader(headers: any[], name: string): string | undefined {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
}

function decodeB64(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function htmlToText(html: string): string {
  try {
    const $ = cheerio.load(html);
    $("script, style, head").remove();
    $("br, p, div, tr, li").each((_, el) => $(el).append("\n"));
    $("td, th").each((_, el) => $(el).append(" | "));
    return he.decode($.text());
  } catch {
    return html.replace(/<[^>]+>/g, " ");
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .substring(0, 6000);
}

function toGmailDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(str: string): string {
  const d = new Date(str);
  if (isNaN(d.getTime())) return new Date().toISOString().substring(0, 10);
  return d.toISOString().substring(0, 10);
}
