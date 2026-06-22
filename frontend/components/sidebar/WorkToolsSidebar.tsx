"use client";

import { FileText, Languages, Mic, PenLine } from "lucide-react";
import ModuleSidebar, { type ModuleSidebarGroup } from "./ModuleSidebar";

export const WORK_NAV_GROUPS: ModuleSidebarGroup[] = [
  {
    titleKey: "sidebar.panel.agents",
    items: [
      {
        icon: PenLine,
        labelKey: "work.writingAssistant",
        href: "/writing-assistant",
        matchPath: "/writing-assistant",
      },
      {
        icon: Languages,
        labelKey: "work.translator",
        href: "/translator",
        matchPath: "/translator",
      },
      {
        icon: Mic,
        labelKey: "work.liveTranslate",
        href: "/live-translate",
        matchPath: "/live-translate",
      },
      {
        icon: FileText,
        labelKey: "work.documentReader",
        href: "/document-reader",
        matchPath: "/document-reader",
      },
    ],
  },
];

export const WORK_PAGE_PATHS = WORK_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.matchPath));
export const WORK_PAGE_HREFS = WORK_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

export default function WorkToolsSidebar() {
  return <ModuleSidebar groups={WORK_NAV_GROUPS} storageKey="work-sidebar-width" />;
}
