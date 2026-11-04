import type { Metadata, Viewport } from "next";
import { DotGothic16, Gaegu } from "next/font/google";
import "./globals.css";

// Pixel type for labels and buttons, handwriting for anything "drawn".
const pixelFont = DotGothic16({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
});

const handFont = Gaegu({
  variable: "--font-hand",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Who's that Pokémon?",
  description: "Pokémon sprite guessing party game",
  icons: {
    icon: "/pokeball.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#e4e6e9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${pixelFont.variable} ${handFont.variable} antialiased`}>{children}</body>
    </html>
  );
}
