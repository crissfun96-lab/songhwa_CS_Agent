import { getDb } from "../firebase-admin";
import { generateTicketId } from "../tickets";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type { Complaint, ComplaintCategory, ComplaintSeverity } from "./types";

export interface CreateComplaintInput {
  name: string;
  phone: string;
  category: ComplaintCategory;
  description: string;
  severity?: ComplaintSeverity;
  visitDate?: string;
  tenantId?: string;
}

export async function createComplaint(
  input: CreateComplaintInput,
): Promise<Complaint> {
  const tid = input.tenantId ?? DEFAULT_TENANT_ID;
  const collection = tc(tid, "complaints");
  const now = new Date().toISOString();
  const complaint: Complaint = {
    id: `complaint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ticketId: generateTicketId("SC"),
    name: input.name,
    phone: input.phone,
    category: input.category,
    description: input.description,
    severity: input.severity ?? inferSeverity(input.description),
    visitDate: input.visitDate ?? null,
    status: "new",
    assignedTo: null,
    resolutionNote: null,
    createdAt: now,
    updatedAt: now,
  };

  await getDb().collection(collection).doc(complaint.id).set(complaint);
  return complaint;
}

function inferSeverity(description: string): ComplaintSeverity {
  const text = description.toLowerCase();
  if (/food poisoning|sick|hospital|injured|hurt|allergic reaction|dangerous/.test(text)) {
    return "critical";
  }
  if (/disgusting|terrible|awful|worst|unacceptable|furious|outrageous/.test(text)) {
    return "high";
  }
  if (/disappointed|not good|poor|slow|cold|wrong/.test(text)) {
    return "medium";
  }
  return "low";
}

export async function getRecentComplaints(
  limit: number = 50,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<Complaint[]> {
  const snapshot = await getDb()
    .collection(tc(tenantId, "complaints"))
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((d) => d.data() as Complaint);
}
