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

interface I18nContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string) => string;
  languages: Language[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function getInitialLanguage(): LanguageCode {
  if (typeof window === "undefined") return "zh-CN";

  const currentLang = document.documentElement.lang as LanguageCode;
  if (LANGUAGES.find((l) => l.code === currentLang)) return currentLang;

  const saved = localStorage.getItem("language") as LanguageCode | null;
  if (saved && LANGUAGES.find((l) => l.code === saved)) return saved;

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

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    localStorage.setItem("language", lang);
    document.documentElement.lang = lang;
  }, []);

  const dict = dictionaries[language] || dictionaries["en"];

  const t = useCallback(
    (key: string) => {
      return dict[key] || key;
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
