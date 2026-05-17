import { getDb } from "../firebase-admin";
import { generateTicketId } from "../tickets";
import type { CallbackRequest, CallbackUrgency } from "./types";
import { URGENCY_ETA_MINUTES } from "./types";

const COLLECTION = "songhwa_callbacks";

export interface CreateCallbackInput {
  name: string;
  phone: string;
  reason: string;
  urgency?: CallbackUrgency;
}

export async function createCallback(
  input: CreateCallbackInput,
): Promise<CallbackRequest> {
  const now = new Date();
  const urgency = input.urgency ?? "medium";
  const etaMinutes = URGENCY_ETA_MINUTES[urgency];
  const promiseBy = new Date(now.getTime() + etaMinutes * 60 * 1000);

  const callback: CallbackRequest = {
    id: `callback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ticketId: generateTicketId("CB"),
    name: input.name,
    phone: input.phone,
    reason: input.reason,
    urgency,
    status: "queued",
    promiseByIso: promiseBy.toISOString(),
    assignedTo: null,
    resolutionNote: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await getDb().collection(COLLECTION).doc(callback.id).set(callback);
  return callback;
}

export async function getActiveCallbacks(): Promise<CallbackRequest[]> {
  const snapshot = await getDb()
    .collection(COLLECTION)
    .where("status", "in", ["queued", "in_progress"])
    .orderBy("urgency", "desc")
    .orderBy("createdAt", "asc")
    .limit(50)
    .get();
  return snapshot.docs.map((d) => d.data() as CallbackRequest);
}
