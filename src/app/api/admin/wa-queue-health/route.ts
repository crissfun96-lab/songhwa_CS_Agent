// Cron endpoint — alerts staff via Telegram when WA queue has dead items.
// Runs daily via vercel.json. Catches sustained Baileys outages that would
// otherwise silently lose staff notifications. Fixes Bug #10.
//
// Triggered by Vercel cron with Authorization: Bearer $CRON_SECRET.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

const QUEUE_COLLECTION = "wa_notification_queue";
const DEAD_THRESHOLD_ATTEMPTS = 3;
const TELEGRAM_API = (token: string) => `https://api.telegram.org/bot${token}/sendMessage`;

interface QueueItem {
  id: string;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
  type: string;
}

async function alertStaff(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STAFF_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(TELEGRAM_API(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  }).catch((err) => console.error("[wa-queue-health] alert failed:", err));
}

export async function GET(request: Request) {
  // Auth: Vercel cron sends Authorization: Bearer $CRON_SECRET
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const snap = await getDb()
      .collection(QUEUE_COLLECTION)
      .where("sentAt", "==", null)
      .where("attempts", ">=", DEAD_THRESHOLD_ATTEMPTS)
      .limit(50)
      .get();

    const deadItems = snap.docs.map((d) => d.data() as QueueItem);

    if (deadItems.length === 0) {
      return NextResponse.json({
        success: true,
        deadCount: 0,
        message: "WA queue healthy — no dead items",
      });
    }

    const oldest = deadItems.reduce((acc, cur) =>
      cur.createdAt < acc.createdAt ? cur : acc,
    );

    const message = [
      "🚨 <b>WA Notification Queue — Dead Items</b>",
      "",
      `<b>${deadItems.length}</b> messages have failed ${DEAD_THRESHOLD_ATTEMPTS}+ times.`,
      `Oldest: <code>${oldest.id}</code> (${oldest.type})`,
      `Created: ${oldest.createdAt}`,
      "",
      "Likely causes:",
      "• Mac mini WA service down (run <code>pm2 list</code>)",
      "• Baileys session banned (delete <code>services/wa-notifier/auth/</code>, rescan QR)",
      "• Bot kicked from <i>Songhwa Reservations</i> group",
      "",
      `Run <code>pm2 logs songhwa-wa</code> to investigate.`,
    ].join("\n");

    await alertStaff(message);

    return NextResponse.json({
      success: true,
      deadCount: deadItems.length,
      oldest: oldest.id,
      alertSent: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[wa-queue-health] error:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
