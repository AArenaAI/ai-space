import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";
import AuthInterceptor from "@/components/AuthInterceptor";
import AppToaster from "@/components/notifications/AppToaster";
import TaskNotificationCenter from "@/components/notifications/TaskNotificationCenter";

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

const preferenceInitScript = `
(function () {
  try {
    var root = document.documentElement;
    root.classList.add("prefs-pending");

    var savedTheme = localStorage.getItem("theme");
    var theme = "light";
    if (savedTheme === "day" || savedTheme === "light") theme = "light";
    else if (savedTheme === "night" || savedTheme === "dark") theme = "dark";
    else if (savedTheme === "green") theme = "green";
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";

    root.classList.remove("light", "dark", "green");
    root.classList.add(theme);

    var supportedLanguages = ["zh-CN", "zh-TW", "en", "ja", "ko", "id", "th", "vi", "es", "fr", "de", "pt-BR", "hi", "ru", "tr", "ms", "fil"];
    var browserLanguageMap = {
      "zh": "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN", "zh-sg": "zh-CN",
      "zh-tw": "zh-TW", "zh-hant": "zh-TW", "zh-hk": "zh-TW", "zh-mo": "zh-TW",
      "en": "en", "ja": "ja", "ko": "ko", "id": "id", "th": "th", "vi": "vi",
      "es": "es", "fr": "fr", "de": "de", "pt": "pt-BR", "pt-br": "pt-BR",
      "hi": "hi", "ru": "ru", "tr": "tr", "ms": "ms", "fil": "fil", "tl": "fil"
    };
    var normalizeLanguage = function (value) {
      if (!value) return null;
      var normalized = String(value).toLowerCase();
      return browserLanguageMap[normalized] || browserLanguageMap[normalized.split("-")[0]] || null;
    };
    var isSupportedLanguage = function (value) {
      return supportedLanguages.indexOf(value) !== -1;
    };
    var savedLanguage = localStorage.getItem("language");
    var languageSource = localStorage.getItem("languageSource");
    if (languageSource === "user" && isSupportedLanguage(savedLanguage)) {
      root.lang = savedLanguage;
    } else {
      var browserLanguages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
      var detectedLanguage = null;
      for (var i = 0; i < browserLanguages.length; i++) {
        detectedLanguage = normalizeLanguage(browserLanguages[i]);
        if (detectedLanguage) break;
      }
      if (detectedLanguage) {
        root.lang = detectedLanguage;
        localStorage.setItem("language", detectedLanguage);
        localStorage.setItem("languageSource", "browser");
      } else if (isSupportedLanguage(savedLanguage)) {
        root.lang = savedLanguage;
      }
    }
  } catch (e) {
    document.documentElement.classList.remove("prefs-pending");
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceInitScript }} />
      </head>
      <body className="antialiased">
        <I18nProvider>
          <ThemeProvider>
            <AuthInterceptor />
            <TaskNotificationCenter />
            {children}
            <AppToaster />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
