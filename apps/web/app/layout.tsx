import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PHLC Trading Console",
  description: "Local low-latency MT5 strategy control",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

