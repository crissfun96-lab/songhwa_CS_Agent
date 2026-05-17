export type ComplaintCategory =
  | "food_quality"
  | "service"
  | "wait_time"
  | "billing"
  | "cleanliness"
  | "other";

export type ComplaintSeverity = "low" | "medium" | "high" | "critical";

export type ComplaintStatus =
  | "new"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "closed";

export interface Complaint {
  id: string;
  ticketId: string;          // SC-YYMMDD-NNNNNN (voice-readable)
  name: string;
  phone: string;
  category: ComplaintCategory;
  description: string;
  severity: ComplaintSeverity;
  visitDate: string | null;  // when incident happened
  status: ComplaintStatus;
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}
