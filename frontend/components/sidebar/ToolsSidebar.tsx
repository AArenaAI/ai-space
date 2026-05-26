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
      {
        icon: Image,
        labelKey: "image.edit.removeBg",
        href: "/image/edit?mode=remove-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Eraser,
        labelKey: "image.edit.replaceBg",
        href: "/image/edit?mode=replace-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Type,
        labelKey: "image.edit.textRemoval",
        href: "/image/edit?mode=text-removal",
        matchPath: "/image/edit",
      },
      {
        icon: ZoomIn,
        labelKey: "image.edit.upscale",
        href: "/image/edit?mode=upscale",
        matchPath: "/image/edit",
      },
    ],
  },
];

export const CREATIVE_PAGE_PATHS = ["/image", "/video", "/templates"];
export const CREATIVE_PAGE_HREFS = MORE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

export default function ToolsSidebar() {
  return <ModuleSidebar groups={MORE_NAV_GROUPS} storageKey="tools-sidebar-width" />;
}
