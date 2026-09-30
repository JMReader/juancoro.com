import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://juancoro.com"),
  title: {
    default: "Juan Manuel Coro",
    template: "%s · Juan Manuel Coro",
  },
  description:
    "Notas de Juan Manuel Coro: producto, IA y cómo construir cosas que funcionan.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
