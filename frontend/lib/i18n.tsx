"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import zhCN from "@/locales/zh-CN";
import zhTW from "@/locales/zh-TW";
import en from "@/locales/en";
import ja from "@/locales/ja";
import ko from "@/locales/ko";
import id from "@/locales/id";
import th from "@/locales/th";
import vi from "@/locales/vi";
import es from "@/locales/es";
import fr from "@/locales/fr";
import de from "@/locales/de";
import ptBR from "@/locales/pt-BR";
import hi from "@/locales/hi";
import ru from "@/locales/ru";
import tr from "@/locales/tr";
import ms from "@/locales/ms";
import fil from "@/locales/fil";

export type LanguageCode = "zh-CN" | "zh-TW" | "en" | "ja" | "ko" | "id" | "th" | "vi" | "es" | "fr" | "de" | "pt-BR" | "hi" | "ru" | "tr" | "ms" | "fil";

export interface Language {
  code: LanguageCode;
  label: string;
  labelEn: string;
}

export const LANGUAGES: Language[] = [
  { code: "zh-CN", label: "简体中文", labelEn: "Simplified Chinese" },
  { code: "zh-TW", label: "繁體中文", labelEn: "Traditional Chinese" },
  { code: "en", label: "English", labelEn: "English" },
  { code: "ja", label: "日本語", labelEn: "Japanese" },
  { code: "ko", label: "한국어", labelEn: "Korean" },
  { code: "id", label: "Bahasa Indonesia", labelEn: "Indonesian" },
  { code: "th", label: "ไทย", labelEn: "Thai" },
  { code: "vi", label: "Tiếng Việt", labelEn: "Vietnamese" },
  { code: "es", label: "Español", labelEn: "Spanish" },
  { code: "fr", label: "Français", labelEn: "French" },
  { code: "de", label: "Deutsch", labelEn: "German" },
  { code: "pt-BR", label: "Português (Brasil)", labelEn: "Brazilian Portuguese" },
  { code: "hi", label: "हिन्दी", labelEn: "Hindi" },
  { code: "ru", label: "Русский", labelEn: "Russian" },
  { code: "tr", label: "Türkçe", labelEn: "Turkish" },
  { code: "ms", label: "Bahasa Melayu", labelEn: "Malay" },
  { code: "fil", label: "Filipino", labelEn: "Filipino" },
];

export type Translations = Record<string, string>;

const dictionaries: Record<LanguageCode, Translations> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en": en,
  "ja": ja,
  "ko": ko,
  "id": id,
  "th": th,
  "vi": vi,
  "es": es,
  "fr": fr,
  "de": de,
  "pt-BR": ptBR,
  "hi": hi,
  "ru": ru,
  "tr": tr,
  "ms": ms,
  "fil": fil,
};

const LANGUAGE_CODES = new Set<LanguageCode>(LANGUAGES.map((language) => language.code));

const browserLanguageMap: Record<string, LanguageCode> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  en: "en",
  ja: "ja",
  ko: "ko",
  id: "id",
  th: "th",
  vi: "vi",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt-BR",
  "pt-br": "pt-BR",
  hi: "hi",
  ru: "ru",
  tr: "tr",
  ms: "ms",
  fil: "fil",
  tl: "fil",
};

function isSupportedLanguage(value: string | null | undefined): value is LanguageCode {
  return Boolean(value && LANGUAGE_CODES.has(value as LanguageCode));
}

function normalizeBrowserLanguage(value: string | null | undefined): LanguageCode | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (browserLanguageMap[normalized]) return browserLanguageMap[normalized];
  const base = normalized.split("-")[0];
  return browserLanguageMap[base] || null;
}

function detectBrowserLanguage(): LanguageCode | null {
  if (typeof window === "undefined") return null;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const language = normalizeBrowserLanguage(candidate);
    if (language) return language;
  }
  return null;
}

interface I18nContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string, params?: Record<string, string>) => string;
  languages: Language[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function getInitialLanguage(): LanguageCode {
  // Keep the initial render deterministic across SSR and the client's first
  // hydration pass. Browser/localStorage language is applied after mount below.
  return "zh-CN";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(getInitialLanguage);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.documentElement.lang = language;
    document.documentElement.classList.remove("prefs-pending");
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const saved = localStorage.getItem("language") as LanguageCode | null;
    if (localStorage.getItem("languageSource") === "user" && isSupportedLanguage(saved)) {
      setLanguageState(saved);
      document.documentElement.lang = saved;
      return;
    }

    const browserLanguage = detectBrowserLanguage();
    if (browserLanguage) {
      localStorage.setItem("language", browserLanguage);
      localStorage.setItem("languageSource", "browser");
      setLanguageState(browserLanguage);
      document.documentElement.lang = browserLanguage;
      return;
    }

    const controller = new AbortController();
    fetch("/api/locale/detect", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { language?: string } | null) => {
        if (!data || !isSupportedLanguage(data.language)) return;
        if (localStorage.getItem("languageSource") === "user") return;
        localStorage.setItem("language", data.language);
        localStorage.setItem("languageSource", "geo");
        setLanguageState(data.language);
        document.documentElement.lang = data.language;
      })
      .catch(() => {
        // Locale detection is best-effort only; keep the current/default language.
      });

    return () => controller.abort();
  }, []);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    localStorage.setItem("language", lang);
    localStorage.setItem("languageSource", "user");
    document.documentElement.lang = lang;
  }, []);

  const dict = dictionaries[language] || dictionaries["en"];

  const t = useCallback(
    (key: string, params?: Record<string, string>) => {
      let text = dict[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(new RegExp(`{${k}}`, "g"), v);
        });
      }
      return text;
    },
    [dict]
  );


  return (
    <I18nContext.Provider value={{ language, setLanguage, t, languages: LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
