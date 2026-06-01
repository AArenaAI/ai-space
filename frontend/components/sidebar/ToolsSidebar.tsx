"use client";

import { Image, Eraser, Type, ZoomIn, ImageIcon, Video } from "lucide-react";
import ModuleSidebar, { type ModuleSidebarGroup } from "./ModuleSidebar";

export const MORE_NAV_GROUPS: ModuleSidebarGroup[] = [
  {
    titleKey: "sidebar.panel.create",
    items: [
      {
        icon: ImageIcon,
        labelKey: "image.generateImage",
        href: "/image",
        matchPath: "/image",
      },
      {
        icon: Video,
        labelKey: "video.generateVideo",
        href: "/video",
        matchPath: "/video",
      },
    ],
  },
  {
    titleKey: "sidebar.panel.tools",
    items: [
      {
        icon: Image,
        labelKey: "image.edit.removeBg",
        href: "/create?mode=remove-bg",
        matchPath: "/create",
      },
      {
        icon: Eraser,
        labelKey: "image.edit.replaceBg",
        href: "/create?mode=replace-bg",
        matchPath: "/create",
      },
      {
        icon: Type,
        labelKey: "image.edit.textRemoval",
        href: "/create?mode=text-removal",
        matchPath: "/create",
      },
      {
        icon: ZoomIn,
        labelKey: "image.edit.upscale",
        href: "/create?mode=upscale",
        matchPath: "/create",
      },
    ],
  },
];

export const CREATIVE_PAGE_PATHS = ["/image", "/video", "/create", "/templates"];
export const CREATIVE_PAGE_HREFS = MORE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

export default function ToolsSidebar() {
  return <ModuleSidebar groups={MORE_NAV_GROUPS} storageKey="tools-sidebar-width" />;
}
