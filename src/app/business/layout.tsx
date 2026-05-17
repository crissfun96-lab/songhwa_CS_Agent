import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foxie AI Receptionist — Voice + WhatsApp for SEA F&B",
  description:
    "Stop missing customer calls. AI receptionist for Malaysian F&B — answers calls in 4 languages, takes reservations, replies on WhatsApp 24/7. From RM 299/mo. Built by Songhwa's CEO.",
  openGraph: {
    title: "Foxie AI Receptionist — Voice + WhatsApp for SEA F&B",
    description: "Your AI receptionist. 24/7. 4 languages. ~RM 2,000/mo cheaper than hiring.",
    type: "website",
    locale: "en_MY",
  },
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
