"use client";

import { FileText, GraduationCap, Languages, Mic, PenLine, Sparkles } from "lucide-react";
import ModuleSidebar, { type ModuleSidebarGroup } from "./ModuleSidebar";

export const WORK_NAV_GROUPS: ModuleSidebarGroup[] = [
  {
    titleKey: "sidebar.panel.agents",
    items: [
      {
        icon: GraduationCap,
        labelKey: "gaokao.navLabel",
        href: "/gaokao-volunteer",
        matchPath: "/gaokao-volunteer",
      },
      {
        icon: Sparkles,
        labelKey: "seedreamBeta.navLabel",
        href: "/ai-comic",
        matchPath: "/ai-comic",
        disabled: true,
      },
      {
        icon: PenLine,
        labelKey: "work.writingAssistant",
        href: "/writing-assistant",
        matchPath: "/writing-assistant",
        disabled: true,
      },
      {
        icon: Languages,
        labelKey: "work.translator",
        href: "/translator",
        matchPath: "/translator",
        disabled: true,
      },
      {
        icon: Mic,
        labelKey: "work.liveTranslate",
        href: "/live-translate",
        matchPath: "/live-translate",
        disabled: true,
      },
      {
        icon: FileText,
        labelKey: "work.documentReader",
        href: "/document-reader",
        matchPath: "/document-reader",
        disabled: true,
      },
    ],
  },
];

export const WORK_PAGE_PATHS = WORK_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.matchPath));
export const WORK_PAGE_HREFS = WORK_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

export default function WorkToolsSidebar() {
  return <ModuleSidebar groups={WORK_NAV_GROUPS} storageKey="work-sidebar-width" />;
}
