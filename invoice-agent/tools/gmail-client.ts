// tools/gmail-client.ts
// Shared Gmail OAuth2 client — baca token dari ~/.openclaw/agents/<agentId>/gmail-token.json

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import os from "os";

// Token disimpan di workspace OpenClaw agent agar mudah diakses
const TOKEN_PATHS = [
  path.join(os.homedir(), ".openclaw", "agents", "main", "gmail-token.json"),
  path.join(process.cwd(), "gmail-token.json"),
];

let cachedClient: ReturnType<typeof google.auth.OAuth2.prototype.constructor> | null = null;

export async function getGmailClient() {
  if (cachedClient) return google.gmail({ version: "v1", auth: cachedClient as any });

  const tokenPath = TOKEN_PATHS.find(fs.existsSync);

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    throw new Error("GMAIL_CLIENT_ID dan GMAIL_CLIENT_SECRET harus ada di env block openclaw.json");
  }
  if (!tokenPath) {
    throw new Error(
      "gmail-token.json tidak ditemukan. Jalankan: npm run auth:gmail\n" +
      "Letakkan file di: " + TOKEN_PATHS[0]
    );
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oauth2.setCredentials(token);

  // Auto-save jika token di-refresh
  oauth2.on("tokens", (newTokens: any) => {
    const updated = { ...token, ...newTokens };
    fs.writeFileSync(tokenPath!, JSON.stringify(updated, null, 2));
  });

  cachedClient = oauth2;
  return google.gmail({ version: "v1", auth: oauth2 as any });
}

export async function getSheetsClient() {
  const tokenPath = TOKEN_PATHS.find(fs.existsSync);

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !tokenPath) {
    throw new Error("Gmail credentials belum di-setup. Jalankan: npm run auth:gmail");
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oauth2.setCredentials(token);

  return google.sheets({ version: "v4", auth: oauth2 as any });
}