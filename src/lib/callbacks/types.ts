export type CallbackUrgency = "low" | "medium" | "high";

export type CallbackStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled";

export interface CallbackRequest {
  id: string;
  ticketId: string;               // CB-YYMMDD-NNNNNN
  name: string;
  phone: string;
  reason: string;                 // brief context
  urgency: CallbackUrgency;
  status: CallbackStatus;
  promiseByIso: string;           // deadline we promised the customer
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export const URGENCY_ETA_MINUTES: Record<CallbackUrgency, number> = {
  high: 15,
  medium: 60,
  low: 120,
};
