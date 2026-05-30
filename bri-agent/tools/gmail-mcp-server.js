#!/usr/bin/env node
/**
 * Gmail MCP Server untuk OpenClaw
 * Membaca email mutasi/transaksi BRI dari Gmail
 * 
 * Dependencies: npm install googleapis @modelcontextprotocol/sdk
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ── Konfigurasi dari environment ──────────────────────────────────────────────
const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
// const REDIRECT_URI  = process.env.GMAIL_REDIRECT_URI  || "urn:ietf:wg:oauth:2.0:oob";
const REDIRECT_URI  = process.env.GMAIL_REDIRECT_URI  || "http://localhost";
const TOKEN_PATH    = process.env.GMAIL_TOKEN_PATH    || path.join(process.env.HOME, ".openclaw", "gmail-token.json");
const BRI_FILTER    = process.env.BRI_EMAIL_FILTER    || "from:bri@bri.co.id OR subject:BRI mutasi";

// ── OAuth2 Setup ──────────────────────────────────────────────────────────────
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

/**
 * Load token yang sudah tersimpan, atau minta otorisasi baru.
 */
async function authorize() {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oAuth2Client.setCredentials(token);

    // Auto-refresh jika token kadaluarsa
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const { credentials } = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(credentials);
      fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
    }
    return;
  }

  // Belum ada token → tampilkan URL otorisasi
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  console.error("==============================================");
  console.error("PERTAMA KALI SETUP – Buka URL ini di browser:");
  console.error(authUrl);
  console.error("==============================================");
  console.error("Lalu masukkan kode yang diberikan Google:");

  const code = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question("Masukkan kode: ", (ans) => { rl.close(); resolve(ans.trim()); });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.error("✅ Token tersimpan di:", TOKEN_PATH);
}

// ── Fungsi Gmail ──────────────────────────────────────────────────────────────

/** Ambil daftar email BRI sesuai filter dan rentang tanggal */
async function listBriEmails({ maxResults = 50, after = null, before = null } = {}) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  
  let query = BRI_FILTER;
  if (after)  query += ` after:${after}`;    // format: YYYY/MM/DD
  if (before) query += ` before:${before}`;  // format: YYYY/MM/DD

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  return res.data.messages || [];
}

/** Ambil konten lengkap satu email berdasarkan ID */
async function getEmailContent(messageId) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg    = res.data;
  const headers = msg.payload.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "";
  const from    = headers.find(h => h.name === "From")?.value    || "";
  const date    = headers.find(h => h.name === "Date")?.value    || "";

  // Ekstrak body teks
  let bodyText = extractBody(msg.payload);

  return { id: messageId, subject, from, date, body: bodyText };
}

/** Rekursif ekstrak body teks dari payload Gmail */
function extractBody(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf8");
    // Strip HTML tags sederhana
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  if (payload.parts) {
    // Prioritaskan text/plain
    const plain = payload.parts.find(p => p.mimeType === "text/plain");
    if (plain) return extractBody(plain);
    // Fallback ke bagian lain
    return payload.parts.map(p => extractBody(p)).join("\n");
  }

  return "";
}

/** Ambil banyak email sekaligus (list + content) */
async function fetchBriEmails(options = {}) {
  const messages = await listBriEmails(options);
  if (messages.length === 0) return [];

  const emails = await Promise.all(
    messages.map(m => getEmailContent(m.id).catch(e => ({
      id: m.id,
      error: e.message,
      subject: "", from: "", date: "", body: ""
    })))
  );
  return emails;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "gmail-bri-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Daftar tool yang tersedia
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_bri_emails",
      description: "Daftar email mutasi/transaksi BRI dari Gmail. Bisa difilter berdasarkan tanggal.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Jumlah email maksimal (default: 50)" },
          after:  { type: "string", description: "Filter email setelah tanggal ini (format: YYYY/MM/DD)" },
          before: { type: "string", description: "Filter email sebelum tanggal ini (format: YYYY/MM/DD)" },
        },
      },
    },
    {
      name: "get_email_content",
      description: "Ambil konten lengkap satu email BRI berdasarkan ID-nya.",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "ID email dari Gmail" },
        },
        required: ["messageId"],
      },
    },
    {
      name: "fetch_bri_emails_range",
      description: "Ambil semua email BRI beserta isinya dalam rentang tanggal tertentu. Untuk analisis harian/bulanan.",
      inputSchema: {
        type: "object",
        properties: {
          after:  { type: "string", description: "Mulai dari tanggal (format: YYYY/MM/DD)" },
          before: { type: "string", description: "Sampai tanggal (format: YYYY/MM/DD)" },
          maxResults: { type: "number", description: "Batas email (default: 100)" },
        },
      },
    },
  ],
}));

// Handler untuk setiap tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_bri_emails": {
        const messages = await listBriEmails({
          maxResults: args.maxResults || 50,
          after:  args.after  || null,
          before: args.before || null,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ total: messages.length, messages }, null, 2),
          }],
        };
      }

      case "get_email_content": {
        const email = await getEmailContent(args.messageId);
        return {
          content: [{ type: "text", text: JSON.stringify(email, null, 2) }],
        };
      }

      case "fetch_bri_emails_range": {
        const emails = await fetchBriEmails({
          after:      args.after      || null,
          before:     args.before     || null,
          maxResults: args.maxResults || 100,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ total: emails.length, emails }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Tool tidak dikenal: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Entry Point ───────────────────────────────────────────────────────────────
async function main() {
  await authorize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Gmail BRI MCP Server berjalan");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
