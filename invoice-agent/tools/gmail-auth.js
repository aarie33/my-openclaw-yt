// tools/gmail-auth.js
// ============================================================
//  One-time Gmail OAuth2 setup
//  Jalankan: npm run auth:gmail
//  Simpan token ke ~/.openclaw/agents/main/gmail-token.json
// ============================================================

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets",
];

const TOKEN_TARGET = path.join(
  os.homedir(), ".openclaw", "agents", "main", "gmail-token.json"
);

async function main() {
  console.log("\n🦞 Agent Invoice — Gmail OAuth Setup");
  console.log("═".repeat(50));

  const openclawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  let clientId = process.env.GMAIL_CLIENT_ID;
  let clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if ((!clientId || !clientSecret) && fs.existsSync(openclawConfigPath)) {
    const config = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
    clientId ??= config.env?.GMAIL_CLIENT_ID;
    clientSecret ??= config.env?.GMAIL_CLIENT_SECRET;
  }

  if (!clientId || !clientSecret) {
    console.error("\n❌ GMAIL_CLIENT_ID dan GMAIL_CLIENT_SECRET tidak ditemukan.");
    console.error("   Tambahkan ke blok `env` di ~/.openclaw/openclaw.json:\n");
    console.error('   { "env": { "GMAIL_CLIENT_ID": "...", "GMAIL_CLIENT_SECRET": "..." } }\n');
    process.exit(1);
  }

  console.log(`✅ Credentials ditemukan dari openclaw.json env`);

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");

  // Cek jika token sudah ada
  if (fs.existsSync(TOKEN_TARGET)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_TARGET, "utf8"));
    oauth2.setCredentials(token);
    try {
      const info = await oauth2.getTokenInfo(token.access_token);
      console.log(`\n✅ Token sudah valid!`);
      console.log(`   Email : ${info.email}`);
      console.log(`\n🚀 Plugin siap digunakan di OpenClaw!\n`);
      return;
    } catch {
      console.log("\n⚠️  Token expired, melakukan re-autentikasi...");
    }
  }

  // Generate auth URL
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n🔐 Autentikasi diperlukan");
  console.log("─".repeat(50));
  console.log("\n1️⃣  Buka URL ini di browser:\n");
  console.log("   " + authUrl + "\n");
  console.log("2️⃣  Login dengan akun Gmail yang mau dipantau");
  console.log("3️⃣  Izinkan akses → salin kode verifikasi");
  console.log("─".repeat(50));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question("\n4️⃣  Paste kode verifikasi: ", async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2.getToken(code.trim());
      oauth2.setCredentials(tokens);

      // Pastikan folder ada
      const dir = path.dirname(TOKEN_TARGET);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(TOKEN_TARGET, JSON.stringify(tokens, null, 2));
      console.log("\n✅ Token disimpan di: " + TOKEN_TARGET);
      console.log("\n🚀 Plugin siap digunakan! Install ke OpenClaw:\n");
      console.log("   openclaw plugins install ./\n");
    } catch (err) {
      console.error("\n❌ Gagal: " + err.message);
      console.error("   Pastikan kode benar dan belum expired.\n");
      process.exit(1);
    }
  });
}

main();