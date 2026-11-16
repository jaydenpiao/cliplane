import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Cliplane — Your next great moment",
  description: "A creator-controlled studio for finding, reviewing and exporting your best gameplay moments.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
