import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CQA Studio — качество диалогов",
  description: "Оценка качества чатов и звонков: настраиваемые критерии, проверяемые доказательства и прозрачные апелляции.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
