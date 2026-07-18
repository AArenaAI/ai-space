"use client";

import { Brush, Image, Eraser, Paintbrush, Type, ZoomIn, ImageIcon, Video } from "lucide-react";
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
        disabled: true,
      },
      {
        icon: Video,
        labelKey: "video.generateVideo",
        href: "/video",
        matchPath: "/video",
        disabled: true,
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
        disabled: true,
      },
      {
        icon: Eraser,
        labelKey: "image.edit.replaceBg",
        href: "/create?mode=replace-bg",
        matchPath: "/create",
        disabled: true,
      },
      {
        icon: Type,
        labelKey: "image.edit.textRemoval",
        href: "/create?mode=text-removal",
        matchPath: "/create",
        disabled: true,
      },
      {
        icon: ZoomIn,
        labelKey: "image.edit.upscale",
        href: "/create?mode=upscale",
        matchPath: "/create",
        disabled: true,
      },
      {
        icon: Brush,
        labelKey: "image.edit.inpaint",
        href: "/create?mode=inpaint",
        matchPath: "/create",
        disabled: true,
      },
      {
        icon: Paintbrush,
        labelKey: "image.edit.regionBrush",
        href: "/create?mode=region-brush",
        matchPath: "/create",
        disabled: true,
      },
    ],
  },
];

export const CREATIVE_PAGE_PATHS = ["/image", "/video", "/create", "/templates"];
export const CREATIVE_PAGE_HREFS = MORE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

export default function ToolsSidebar() {
  return <ModuleSidebar groups={MORE_NAV_GROUPS} storageKey="tools-sidebar-width" />;
}
