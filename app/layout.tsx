import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "璞石新人支持系統",
    template: "%s｜璞石新人支持系統",
  },
  description: "璞石集團新人 90 天支持計畫：計畫、執行、回報、主管回應、HR 稽核。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
