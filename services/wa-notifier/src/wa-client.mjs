// Baileys wrapper — one persistent WA session, send-to-group helper.
// Session auth state lives in ./auth/ (a folder of JSON files).

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import qrcodePng from "qrcode";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, "..", "auth");

const logger = pino({ level: "warn" });

export class WaClient {
  constructor(targetGroupName, pairingPhone) {
    this.targetGroupName = targetGroupName;
    this.pairingPhone = pairingPhone; // international, no +
    this.sock = null;
    this.targetJid = null;
    this.ready = false;
    this.onReady = null;
    this.pairCodeRequested = false;
  }

  async start() {
    console.log(`Auth dir: ${AUTH_DIR}`);
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: ["Songhwa Notifier", "Chrome", "1.0"],
    });

    this.sock.ev.on("creds.update", saveCreds);

    // If this is a fresh login (no registered creds), request pairing code
    // — 8-char code user types into WhatsApp → Linked Devices → Link with phone number
    if (!this.sock.authState.creds.registered && this.pairingPhone) {
      setTimeout(async () => {
        if (!this.pairCodeRequested) {
          this.pairCodeRequested = true;
          try {
            const code = await this.sock.requestPairingCode(this.pairingPhone);
            const formatted = code.match(/.{1,4}/g).join("-");
            console.log("\n╔════════════════════════════════════════════════╗");
            console.log("║                                                ║");
            console.log(`║   PAIRING CODE:  ${formatted}                   ║`);
            console.log("║                                                ║");
            console.log("╚════════════════════════════════════════════════╝\n");
            console.log(`On the +${this.pairingPhone} phone:`);
            console.log("  WhatsApp → Settings → Linked Devices →");
            console.log("  Link a Device → Link with phone number instead →");
            console.log(`  Type this code: ${formatted}\n`);
          } catch (e) {
            console.error("Pairing code request failed:", e.message);
            console.log("Falling back to QR scan...");
          }
        }
      }, 3000);
    }

    this.sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !this.pairingPhone) {
        console.log("\n=== SCAN THIS QR ===");
        qrcode.generate(qr, { small: true });

        // Also save as PNG and open in Preview (macOS)
        try {
          await qrcodePng.toFile("/tmp/songhwa-wa-qr.png", qr, {
            width: 600,
            margin: 2,
            errorCorrectionLevel: "H",
          });
          console.log("\n📷 QR saved to: /tmp/songhwa-wa-qr.png");
          console.log("Opening in Preview...");
          exec("open /tmp/songhwa-wa-qr.png", () => {});
        } catch (e) {
          console.error("PNG save failed:", e.message);
        }
      }

      if (connection === "open") {
        console.log("✓ WhatsApp connected.");
        await this._findTargetGroup();
      } else if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`Connection closed. Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        } else {
          console.log("Logged out — delete ./auth and rerun to re-link.");
          process.exit(1);
        }
      }
    });
  }

  async _findTargetGroup(attempt = 1, maxAttempts = 10) {
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const list = Object.values(groups);
      console.log(`\n[attempt ${attempt}/${maxAttempts}] Joined groups (${list.length}):`);
      for (const g of list) {
        const isTarget =
          g.subject?.toLowerCase() === this.targetGroupName.toLowerCase();
        const marker = isTarget ? "→ TARGET" : "        ";
        console.log(`  ${marker} ${g.subject} (${g.id})`);
      }
      const match = list.find(
        (g) => g.subject?.toLowerCase() === this.targetGroupName.toLowerCase(),
      );
      if (match) {
        this.targetJid = match.id;
        this.ready = true;
        console.log(`\n✓ Target group found: ${match.subject} (${match.id})\n`);
        if (this.onReady) this.onReady();
        return;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(5000 * attempt, 30000);
        console.log(
          `\n⚠ Group "${this.targetGroupName}" not found yet. Retrying in ${delay / 1000}s (WA may still be syncing)...\n`,
        );
        setTimeout(() => this._findTargetGroup(attempt + 1, maxAttempts), delay);
      } else {
        console.log(
          `\n✗ Gave up after ${maxAttempts} attempts. Ensure +${this.pairingPhone || ""} is in the "${this.targetGroupName}" group, then restart the service.\n`,
        );
      }
    } catch (err) {
      console.error(`Group fetch failed (attempt ${attempt}):`, err.message);
      if (attempt < maxAttempts) {
        setTimeout(() => this._findTargetGroup(attempt + 1, maxAttempts), 5000);
      }
    }
  }

  async send(text) {
    if (!this.ready || !this.targetJid) {
      throw new Error("WA client not ready (target group not found yet)");
    }
    await this.sock.sendMessage(this.targetJid, { text });
  }

  isReady() {
    return this.ready;
  }
}
