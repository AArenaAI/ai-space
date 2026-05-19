import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "sonner";
import AuthInterceptor from "@/components/AuthInterceptor";

export const metadata: Metadata = {
  title: "AI Space - 多模型AI聚合平台",
  description: "一个入口，所有顶尖AI。集成 GPT、Claude、Gemini、DeepSeek、Kimi 等主流大模型。",
  keywords: "AI聚合,多模型,ChatGPT,Claude,DeepSeek,Kimi,Gemini",
  icons: {
    icon: [
      { url: "/brand-dark-logo.png", sizes: "128x128", type: "image/png" },
      { url: "/brand-dark-logo.png", sizes: "192x192", type: "image/png" },
      { url: "/brand-dark-logo.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/brand-dark-logo.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AuthInterceptor />
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 3500,
            }}
            closeButton
            richColors={false}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
