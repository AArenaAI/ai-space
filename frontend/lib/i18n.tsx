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

  useEffect(() => {
    if (!mounted || typeof document === "undefined") return;

    const zhDict = dictionaries["zh-CN"];
    const enDict = dictionaries.en;
    const zhToEn = new Map<string, string>();
    const enToZh = new Map<string, string>();

    Object.keys(zhDict).forEach((key) => {
      const zh = zhDict[key];
      const enValue = enDict[key];
      if (!zh || !enValue || zh === enValue) return;
      zhToEn.set(zh, enValue);
      enToZh.set(enValue, zh);
    });

    const map = language === "en" ? zhToEn : enToZh;
    const attrNames = ["placeholder", "title", "aria-label", "alt"];

    const translateText = (value: string) => {
      const trimmed = value.trim();
      const translated = map.get(trimmed);
      if (!translated) return value;
      const leading = value.match(/^\s*/)?.[0] ?? "";
      const trailing = value.match(/\s*$/)?.[0] ?? "";
      return `${leading}${translated}${trailing}`;
    };

    const translateNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const next = translateText(node.textContent);
        if (next !== node.textContent) node.textContent = next;
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(el.tagName)) {
        attrNames.forEach((attr) => {
          const value = el.getAttribute(attr);
          if (!value) return;
          const next = translateText(value);
          if (next !== value) el.setAttribute(attr, next);
        });
        return;
      }

      attrNames.forEach((attr) => {
        const value = el.getAttribute(attr);
        if (!value) return;
        const next = translateText(value);
        if (next !== value) el.setAttribute(attr, next);
      });
      el.childNodes.forEach(translateNode);
    };

    const run = () => translateNode(document.body);
    run();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateNode(mutation.target);
        mutation.addedNodes.forEach(translateNode);
        if (mutation.type === "attributes") translateNode(mutation.target);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: attrNames,
    });
    return () => observer.disconnect();
  }, [language, mounted]);

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
