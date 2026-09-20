import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARCA — wildfire values at risk",
  description:
    "Ranks the schools, care homes, hospitals and farms a wildfire will reach, by how much time each has left.",
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
