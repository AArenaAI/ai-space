"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import zhCN from "@/locales/zh-CN";
import en from "@/locales/en";

export type LanguageCode = "zh-CN" | "en";

export interface Language {
  code: LanguageCode;
  label: string;
  labelEn: string;
}

export const LANGUAGES: Language[] = [
  { code: "zh-CN", label: "简体中文", labelEn: "Simplified Chinese" },
  { code: "en", label: "English", labelEn: "English" },
];

export type Translations = Record<string, string>;

const dictionaries: Record<LanguageCode, Translations> = {
  "zh-CN": zhCN,
  "en": en,
};

interface I18nContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string) => string;
  languages: Language[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>("zh-CN");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("language") as LanguageCode | null;
    if (saved && LANGUAGES.find((l) => l.code === saved)) {
      setLanguageState(saved);
      document.documentElement.lang = saved;
    }
  }, []);

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
