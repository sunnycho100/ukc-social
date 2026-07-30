import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_KR } from "next/font/google";
import { createServerSupabase } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import "./globals.css";

// Inter for Latin text everywhere (headings + body); Noto Sans KR loaded
// separately as --font-kr and chained in as a fallback in globals.css so
// Korean glyphs (which Inter doesn't cover) still render in a matching web
// font instead of dropping to a generic system face.
const display = Inter({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
});
const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const kr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-kr",
});

export async function generateMetadata(): Promise<Metadata> {
  const supabase = await createServerSupabase();
  const conference = await getConference(supabase);
  return {
    title: "Icebreaker",
    description: conference?.name
      ? `Find your table at ${conference.name}: dinners, rides, and people worth meeting.`
      : "Find your table: dinners, rides, and people worth meeting.",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A121C",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${display.variable} ${body.variable} ${kr.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
