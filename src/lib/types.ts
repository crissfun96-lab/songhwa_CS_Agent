export type ReservationStatus =
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

export interface ReservationModification {
  at: string; // ISO timestamp
  by: "agent" | "admin" | "customer";
  actor?: string; // session ID or admin username
  changes: Record<string, { from: unknown; to: unknown }>;
  reason?: string;
}

export interface Reservation {
  id: string;
  name: string;
  phone: string;
  phoneNormalized?: string; // canonical form for indexed lookup (see normalizePhone)
  date: string;
  time: string;
  pax: number;
  menuChoice: string;
  remarks: string;
  createdAt: string;
  status?: ReservationStatus;
  modifications?: ReservationModification[];
  updatedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdBySessionId?: string;   // for ownership verification on PATCH/DELETE
}

export interface CustomerProfile {
  name: string;
  nameLower: string;
  phone: string;
  phoneNormalized?: string; // canonical (digits, "0..." MY format) for indexed lookup
  visitCount: number;
  lastVisit: string;
  favoriteOrders: string[];
  reservations: {
    date: string;
    time: string;
    pax: number;
    menuChoice: string;
    remarks: string;
  }[];
}
