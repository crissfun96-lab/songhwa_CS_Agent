// Shared ticket ID generation for complaints + callbacks.
// Format: PREFIX-YYMMDD-NNNNNN (readable over voice)
// Example: SC-260419-472831
//
// Collisions: 1 in a million per day per prefix — fine for restaurant scale.

export type TicketPrefix = "SC" | "CB";

export function generateTicketId(prefix: TicketPrefix): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    parts[p.type] = p.value;
  }
  const yymmdd = `${parts.year}${parts.month}${parts.day}`;
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${yymmdd}-${rand}`;
}

export function spellTicketForVoice(ticketId: string): string {
  // Agent reads: "S-C, two-six-oh-four-one-nine, four-seven-two-eight-three-one"
  return ticketId
    .split("-")
    .map((part) => {
      if (/^[A-Z]+$/.test(part)) {
        return part.split("").join("-");
      }
      return part.split("").join("-");
    })
    .join(", ");
}
