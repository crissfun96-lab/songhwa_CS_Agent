// Conversation history per customer WhatsApp phone.
// Stored per-phone in Firestore so the dispatcher has multi-turn context.

import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";

const MAX_TURNS = 30; // last N turns kept; older trimmed

export type ConvRole = "user" | "model" | "function";

export interface ConvMessage {
  role: ConvRole;
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  at: string;
}

interface ConvDoc {
  phone: string;
  phoneNormalized: string;
  customerName: string | null;
  messages: ConvMessage[];
  lastUpdatedAt: string;
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "") || "unknown";
}

export async function loadHistory(
  phone: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<ConvMessage[]> {
  const doc = await getDb()
    .collection(tc(tenantId, "conversation_history"))
    .doc(phoneKey(phone))
    .get();
  if (!doc.exists) return [];
  const data = doc.data() as ConvDoc;
  return data.messages ?? [];
}

export async function appendMessage(
  phone: string,
  message: ConvMessage,
  customerName?: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const ref = getDb()
    .collection(tc(tenantId, "conversation_history"))
    .doc(phoneKey(phone));
  await getDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const existing = (doc.data() as ConvDoc | undefined) ?? null;
    const messages = existing?.messages ?? [];
    const newMessages = [...messages, message].slice(-MAX_TURNS);
    tx.set(
      ref,
      {
        phone,
        phoneNormalized: phoneKey(phone),
        customerName: customerName ?? existing?.customerName ?? null,
        messages: newMessages,
        lastUpdatedAt: new Date().toISOString(),
      } satisfies ConvDoc,
      { merge: false },
    );
  });
}

export async function clearHistory(
  phone: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  await getDb()
    .collection(tc(tenantId, "conversation_history"))
    .doc(phoneKey(phone))
    .delete();
}
