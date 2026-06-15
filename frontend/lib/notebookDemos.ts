import type { Notebook } from "@/lib/notebookTypes";

export type DemoNotebook = Notebook & {
  demo: true;
  color: string;
};

export type FeaturedNotebook = Notebook & {
  featured: true;
  publisher: string;
  topic: string;
  palette: string;
  illustration: string;
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

export const FEATURED_NOTEBOOKS: FeaturedNotebook[] = [
  {
    id: -101,
    user_id: 0,
    workspace_id: 0,
    title: "World History: Empires, Revolutions & Modernity",
    description: "A survey notebook for timelines, primary sources, and comparative history questions.",
    cover_icon: "featured-history",
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-18T00:00:00.000Z",
    file_count: 42,
    featured: true,
    publisher: "AI Space Curated",
    topic: "History",
    palette: "from-amber-900 via-stone-800 to-slate-950",
    illustration: "map",
  },
  {
    id: -102,
    user_id: 0,
    workspace_id: 0,
    title: "Meeting Intelligence: Notes, Decisions & Action Items",
    description: "Turn meeting transcripts into summaries, owners, follow-ups, and decision logs.",
    cover_icon: "featured-meetings",
    created_at: "2026-05-02T00:00:00.000Z",
    updated_at: "2026-05-02T00:00:00.000Z",
    file_count: 18,
    featured: true,
    publisher: "AI Space Workflows",
    topic: "Meetings",
    palette: "from-sky-950 via-indigo-900 to-slate-950",
    illustration: "meeting",
  },
  {
    id: -103,
    user_id: 0,
    workspace_id: 0,
    title: "Game Worlds: Lore, Mechanics & Level Design",
    description: "Analyze game bibles, quests, characters, mechanics, and worldbuilding systems.",
    cover_icon: "featured-games",
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:00.000Z",
    file_count: 27,
    featured: true,
    publisher: "AI Space Curated",
    topic: "Gaming",
    palette: "from-violet-950 via-fuchsia-900 to-slate-950",
    illustration: "game",
  },
  {
    id: -104,
    user_id: 0,
    workspace_id: 0,
    title: "Luxury Brands: Dior, Prada & Modern Fashion Strategy",
    description: "Compare maison heritage, campaigns, runway notes, and brand positioning.",
    cover_icon: "featured-luxury",
    created_at: "2026-04-09T00:00:00.000Z",
    updated_at: "2026-04-09T00:00:00.000Z",
    file_count: 31,
    featured: true,
    publisher: "AI Space Brand Lab",
    topic: "Brands",
    palette: "from-neutral-950 via-zinc-800 to-rose-950",
    illustration: "brand",
  },
  {
    id: -105,
    user_id: 0,
    workspace_id: 0,
    title: "K‑Pop Playbook: Idols, Fandoms & Global Promotion",
    description: "Study comeback cycles, fandom operations, visual concepts, and platform strategy.",
    cover_icon: "featured-kpop",
    created_at: "2026-03-26T00:00:00.000Z",
    updated_at: "2026-03-26T00:00:00.000Z",
    file_count: 24,
    featured: true,
    publisher: "AI Space Culture Desk",
    topic: "K‑Pop",
    palette: "from-pink-950 via-purple-900 to-indigo-950",
    illustration: "kpop",
  },
  {
    id: -106,
    user_id: 0,
    workspace_id: 0,
    title: "Brand Launch Kit: Positioning, Naming & Go‑To‑Market",
    description: "A startup-friendly notebook for brand briefs, audience research, and campaign plans.",
    cover_icon: "featured-launch",
    created_at: "2026-03-12T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
    file_count: 21,
    featured: true,
    publisher: "AI Space Brand Lab",
    topic: "Branding",
    palette: "from-emerald-950 via-teal-900 to-slate-950",
    illustration: "launch",
  },
];

export const READONLY_NOTEBOOKS = [...NOTEBOOK_DEMOS, ...FEATURED_NOTEBOOKS];
