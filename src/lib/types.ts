export interface Reservation {
  id: string;
  name: string;
  phone: string;
  date: string;
  time: string;
  pax: number;
  menuChoice: string;
  remarks: string;
  createdAt: string;
}

export interface CustomerProfile {
  name: string;
  nameLower: string;
  phone: string;
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
