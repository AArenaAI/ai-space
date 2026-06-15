import type { Notebook, NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";

export type DemoNotebook = Notebook & {
  demo: true;
  color: string;
};

export type ReadonlyNotebookSource = {
  id: number;
  title: string;
  url: string;
  publisher: string;
  summary: string;
  content: string;
};

export type FeaturedNotebook = Notebook & {
  featured: true;
  publisher: string;
  topic: string;
  palette: string;
  illustration: "map" | "meeting" | "game" | "brand" | "kpop" | "launch";
  sources: ReadonlyNotebookSource[];
};

function source(
  id: number,
  title: string,
  url: string,
  publisher: string,
  summary: string,
  content: string,
): ReadonlyNotebookSource {
  return { id, title, url, publisher, summary, content };
}

function readonlyFile(notebookId: number, item: ReadonlyNotebookSource): NotebookFile {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    id: item.id,
    notebook_id: notebookId,
    file_id: item.id,
    sort_order: item.id,
    created_at: now,
    updated_at: now,
    file: {
      id: item.id,
      public_id: `readonly-${Math.abs(notebookId)}-${item.id}`,
      filename: item.title,
      mime_type: "text/html; source=url",
      size: item.content.length,
      parse_status: "done",
      embedding_status: "skipped",
      summary: item.summary,
      page_count: 1,
      token_count: Math.max(120, Math.round(item.content.length / 4)),
      created_at: now,
      updated_at: now,
    },
  };
}

function getReadonlySources(notebook: Notebook): ReadonlyNotebookSource[] {
  if (!("sources" in notebook)) return [];
  const sources = (notebook as { sources?: ReadonlyNotebookSource[] }).sources;
  return Array.isArray(sources) ? sources : [];
}

export function readonlyNotebookFiles(notebook: Notebook): NotebookFile[] {
  return getReadonlySources(notebook).map((item) => readonlyFile(notebook.id, item));
}

export function readonlyNotebookFileContent(notebook: Notebook, fileId: number): NotebookFileContent | null {
  const item = getReadonlySources(notebook).find((sourceItem) => sourceItem.id === fileId);
  if (!item) return null;
  const file = readonlyFile(notebook.id, item).file;
  const content = `${item.title}\n${item.publisher}\n${item.url}\n\n${item.content}`;
  return {
    file,
    content,
    chunks: [
      { index: 1, block_type: "source", content: `${item.summary}\n\nOriginal source: ${item.url}` },
      { index: 2, block_type: "notes", content: item.content },
    ],
  };
}

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
    file_count: 3,
    featured: true,
    publisher: "U.S. National Archives",
    topic: "History",
    palette: "from-amber-900 via-stone-800 to-slate-950",
    illustration: "map",
    sources: [
      source(10101, "Declaration of Independence: A Transcription", "https://www.archives.gov/founding-docs/declaration-transcript", "U.S. National Archives", "Official transcript of the Declaration of Independence, useful for studying revolutionary political language and founding-era arguments.", "Primary-source transcript of the Declaration of Independence from the U.S. National Archives. Use it to compare grievances, natural-rights language, and the structure of revolutionary claims."),
      source(10102, "Constitution of the United States: A Transcription", "https://www.archives.gov/founding-docs/constitution-transcript", "U.S. National Archives", "Official transcript of the U.S. Constitution for institutional design, checks and balances, and federal structure.", "Primary-source transcript of the Constitution. Use it to analyze the architecture of federal power, legislative process, executive authority, judiciary design, and amendment procedure."),
      source(10103, "Bill of Rights: A Transcription", "https://www.archives.gov/founding-docs/bill-of-rights-transcript", "U.S. National Archives", "Official transcript of the first ten amendments to the Constitution.", "Primary-source transcript of the Bill of Rights. Use it to study civil liberties, individual rights, due process, and the early constitutional settlement after ratification."),
    ],
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
    file_count: 3,
    featured: true,
    publisher: "Atlassian + Open Knowledge",
    topic: "Meetings",
    palette: "from-sky-950 via-indigo-900 to-slate-950",
    illustration: "meeting",
    sources: [
      source(10201, "How to Write Meeting Minutes", "https://www.atlassian.com/work-management/project-management/meeting-minutes", "Atlassian", "Practical guide to meeting minutes, decisions, and follow-up documentation.", "Atlassian guide on meeting minutes. Use it to define a consistent template for agenda, attendees, decisions, owners, and follow-up items."),
      source(10202, "Meeting", "https://en.wikipedia.org/wiki/Meeting", "Wikipedia", "Overview of meeting types, purposes, and organizational contexts.", "Reference overview of meetings as coordination structures. Use it to classify meeting types and map them to different note-taking workflows."),
      source(10203, "Action Item", "https://en.wikipedia.org/wiki/Action_item", "Wikipedia", "Definition and use of action items in project and meeting follow-up.", "Reference source for action items. Use it to distinguish decisions from tasks and to track owner, due date, and completion state after a meeting."),
    ],
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
    file_count: 3,
    featured: true,
    publisher: "Game Design References",
    topic: "Gaming",
    palette: "from-violet-950 via-fuchsia-900 to-slate-950",
    illustration: "game",
    sources: [
      source(10301, "Game Design", "https://en.wikipedia.org/wiki/Game_design", "Wikipedia", "Overview of game design as rules, systems, mechanics, goals, and player experience.", "Reference overview of game design. Use it to separate mechanics, goals, rules, challenge, balance, and player experience when analyzing a game bible."),
      source(10302, "Level Design", "https://en.wikipedia.org/wiki/Level_design", "Wikipedia", "Overview of level design, spaces, progression, and gameplay pacing.", "Reference overview of level design. Use it to analyze spatial layout, challenge escalation, route planning, encounter placement, and pacing."),
      source(10303, "Worldbuilding", "https://en.wikipedia.org/wiki/Worldbuilding", "Wikipedia", "Overview of constructing fictional worlds, histories, cultures, and internal logic.", "Reference overview of worldbuilding. Use it to analyze lore bibles, factions, geography, cosmology, rules, and narrative consistency."),
    ],
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
    file_count: 3,
    featured: true,
    publisher: "LVMH + Prada Group",
    topic: "Brands",
    palette: "from-neutral-950 via-zinc-800 to-rose-950",
    illustration: "brand",
    sources: [
      source(10401, "Christian Dior — LVMH House Profile", "https://www.lvmh.com/houses/fashion-leather-goods/christian-dior/", "LVMH", "Official LVMH house profile for Christian Dior.", "Official LVMH profile for Christian Dior. Use it to study maison positioning, heritage language, category structure, and luxury-group presentation."),
      source(10402, "Prada Group History", "https://www.pradagroup.com/en/group/history.html", "Prada Group", "Official Prada Group history page covering brand development and milestones.", "Official Prada Group history. Use it to study brand origin, milestone storytelling, product evolution, and institutional presentation."),
      source(10403, "Luxury Goods", "https://en.wikipedia.org/wiki/Luxury_goods", "Wikipedia", "Reference overview of luxury goods, exclusivity, pricing, and consumption signals.", "Reference overview of luxury goods. Use it to compare exclusivity, scarcity, symbolic value, quality claims, and premium pricing across brands."),
    ],
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
    file_count: 3,
    featured: true,
    publisher: "Culture References",
    topic: "K‑Pop",
    palette: "from-pink-950 via-purple-900 to-indigo-950",
    illustration: "kpop",
    sources: [
      source(10501, "K-pop", "https://en.wikipedia.org/wiki/K-pop", "Wikipedia", "Overview of K-pop as an industry, genre, training system, and global cultural product.", "Reference overview of K-pop. Use it to analyze idol training, agencies, music formats, choreography, visual concepts, and global distribution."),
      source(10502, "Korean Wave", "https://en.wikipedia.org/wiki/Korean_wave", "Wikipedia", "Overview of Hallyu and the international spread of Korean popular culture.", "Reference overview of the Korean Wave. Use it to place K-pop inside broader cultural export, television, film, beauty, food, and tourism strategies."),
      source(10503, "Fandom", "https://en.wikipedia.org/wiki/Fandom", "Wikipedia", "Reference overview of fandom communities, participation, and identity.", "Reference overview of fandom. Use it to study fan labor, community norms, identity, online organization, and promotion dynamics."),
    ],
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
    file_count: 3,
    featured: true,
    publisher: "Brand Strategy References",
    topic: "Branding",
    palette: "from-emerald-950 via-teal-900 to-slate-950",
    illustration: "launch",
    sources: [
      source(10601, "Brand", "https://en.wikipedia.org/wiki/Brand", "Wikipedia", "Reference overview of brand identity, recognition, associations, and differentiation.", "Reference overview of brands. Use it to define identity, recognition, meaning, naming, symbols, and differentiation."),
      source(10602, "Brand Management", "https://en.wikipedia.org/wiki/Brand_management", "Wikipedia", "Reference overview of brand management, positioning, equity, and portfolio decisions.", "Reference overview of brand management. Use it to study positioning, brand equity, architecture, extension, and long-term governance."),
      source(10603, "Go-to-market Strategy", "https://en.wikipedia.org/wiki/Go-to-market_strategy", "Wikipedia", "Reference overview of go-to-market strategy for delivering products to target customers.", "Reference overview of go-to-market strategy. Use it to connect positioning with channels, pricing, sales motion, launch planning, and target segments."),
    ],
  },
];

export const READONLY_NOTEBOOKS = [...NOTEBOOK_DEMOS, ...FEATURED_NOTEBOOKS];
