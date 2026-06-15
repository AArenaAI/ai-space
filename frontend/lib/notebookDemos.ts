import type { Notebook } from "@/lib/notebookTypes";

export type DemoNotebook = Notebook & {
  demo: true;
  color: string;
};

export const NOTEBOOK_DEMOS: DemoNotebook[] = [
  {
    id: -1,
    user_id: 0,
    workspace_id: 0,
    title: "Demo: Introduction to Wisebase",
    description: "Learn how notebooks organize sources",
    cover_icon: "aispace-logo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    file_count: 3,
    demo: true,
    color: "text-violet-500 bg-violet-500/10",
  },
];
