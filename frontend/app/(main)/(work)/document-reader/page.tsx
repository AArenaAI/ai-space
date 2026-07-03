"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Dynamic import react-pdf components with SSR disabled
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false }
);
const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
);
import {
  FileText,
  UploadCloud,
  X,
  Loader2,
  Send,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  LayoutList,
  Trash2,
  BookOpen,
  Clock,
  BarChart3,
  Globe,
  Plus,
  Network,
  Image as ImageIcon,
  MessageSquare,
  History,
  PanelLeftClose,
  FileJson,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import HistoryDrawer, { type HistoryItem as DrawerHistoryItem } from "@/components/ui/HistoryDrawer";
import { consumeChatStream } from "@/lib/chatStream";
import { getErrorMessage, normalizeError, readApiError, showUserError } from "@/lib/errors";
import { LanguageCode, useI18n } from "@/lib/i18n";
import { apiFetch, apiJson } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";

const MarkdownRenderer = dynamic(() => import("@/components/chat/MarkdownRenderer"), { ssr: false });
const ChartLoading = ({ className = "h-[360px]" }: { className?: string }) => {
  const { t } = useI18n();
  return (
    <div className={cn("flex w-full items-center justify-center text-sm text-text-tertiary", className)}>
      {t("docReader.visual.loading")}
    </div>
  );
};

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <ChartLoading />,
});

const SKILL_KEY = "document-reader";
const DEFAULT_MODEL = "gemini-2.5-pro";
const STORAGE_KEY_FILES = "doc-reader-files";
const STORAGE_KEY_CONV = "doc-reader-conv";

const LANGUAGE_NAME_MAP: Record<LanguageCode, string> = {
  "zh-CN": "Simplified Chinese (zh-CN)",
  "zh-TW": "Traditional Chinese (zh-TW)",
  en: "English (en)",
  ja: "Japanese (ja)",
  ko: "Korean (ko)",
  id: "Indonesian (id)",
  th: "Thai (th)",
  vi: "Vietnamese (vi)",
  es: "Spanish (es)",
  fr: "French (fr)",
  de: "German (de)",
  "pt-BR": "Brazilian Portuguese (pt-BR)",
  hi: "Hindi (hi)",
  ru: "Russian (ru)",
  tr: "Turkish (tr)",
  ms: "Malay (ms)",
  fil: "Filipino (fil)",
};

const formatI18n = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);

const docFileError = (error: unknown, fallbackMessage: string) =>
  getErrorMessage(error, { module: "file", fallbackMessage });

const docChatError = (error: unknown, fallbackMessage: string) =>
  getErrorMessage(error, { module: "chat", fallbackMessage });

const buildLanguageConfigPrompt = (targetLanguage: string, outputFormat: "markdown" | "json") => `【Language Settings】
- source_language: auto_detect
- target_language: ${targetLanguage}
- output_mode: monolingual
- keep_quotes_in_original: true
- preserve_proper_nouns: true
- preserve_acronyms: true
- term_policy: first_occurrence_original_plus_translation
- schema_key_language: ${outputFormat === "json" ? "fixed English keys" : "not applicable"}
- schema_value_language: ${targetLanguage}

【Multilingual Processing Rules】
1. Identify the input language first. If the document contains mixed languages, understand each segment separately and synthesize the result in target_language.
2. Stay faithful to the document. Do not add facts, conclusions, numbers, dates, or relationships that are not supported by the document.
3. Keep people, places, organizations, brands, product names, acronyms, and technical terms consistent.
4. For proper nouns and domain terms, keep the original form on first occurrence and add a target-language explanation or translation when helpful.
5. Preserve exact numbers, dates, units, formulas, citations, and limitations. Convert dates/units only when the meaning is unambiguous; otherwise keep the original and mark needs_review.
6. If a term, name, relation, or context is ambiguous, do not guess. Mark it as uncertain, needs_review, or confidence=low.
7. Quoted evidence should remain in the original language; add target-language explanation only when necessary.`;

/* ─── types ─── */

type DocFile = {
  id: string;
  name: string;
  publicId: string;
  size: number;
  type: string;
  uploadedAt: string;
  url: string;
  pageCount?: number;
  parseStatus?: string;
  errorMessage?: string;
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  isStreaming?: boolean;
};

type RightTab = "study" | "graph" | "infographic";

type HistoryItem = {
  id: number;
  title: string;
  model: string;
  message_count: number;
  updated_at: string;
};

type ArtifactKind = "knowledge_graph" | "infographic";

type DocumentArtifact = {
  id: number;
  kind: ArtifactKind;
  title: string;
  summary?: string;
  payload: any;
  raw?: string;
  file_public_id: string;
  created_at: string;
  updated_at: string;
};
type FileStatus = {
  parse_status?: string;
  error_message?: string;
  page_count?: number;
};

type KnowledgeGraphNode = {
  id: string;
  label: string;
  type?: string;
  group?: string;
  description?: string;
  importance?: number;
};

type KnowledgeGraphEdge = {
  source: string;
  target: string;
  label?: string;
  weight?: number;
  confidence?: string;
  evidence?: string;
};

type KnowledgeGraphResult = {
  title?: string;
  topics?: string[];
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary?: string[];
  raw?: string;
};

type InfographicSection = {
  section_title: string;
  section_purpose?: string;
  key_points?: string[];
  data_points?: string[];
  visual_type?: string;
  priority?: string;
};

type InfographicResult = {
  title?: string;
  subtitle?: string;
  summary?: string;
  sections?: InfographicSection[];
  highlights?: string[];
  keywords?: string[];
  style_recommendation?: {
    tone?: string;
    layout?: string;
    color_theme?: string;
    icon_style?: string;
  };
  ready_to_design_copy?: string;
  raw?: string;
};

/* ─── helpers ─── */


function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGenerationTaskId(meta: Record<string, unknown>): number | null {
  const task = (meta._generation_task || meta._background_task) as Record<string, unknown> | undefined;
  const id = Number(task?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function extractTextFromChatResponse(data: any): string {
  const choice = data?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || data?.message?.content || data?.content || "";
}

async function createConversation(title: string, model: string) {
  const res = await apiFetch("/conversations", {
    method: "POST",
    body: JSON.stringify({ title, model, skill_key: SKILL_KEY }),
  });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json() as Promise<{ id: number }>;
}

async function fetchDocumentReaderChatStream(payload: Record<string, any>): Promise<Response> {
  let conversationId = payload.conversation_id;
  if (!conversationId) {
    const fallbackTitle = payload.transient ? "Document visualization" : "Document reader";
    const conv = await createConversation(fallbackTitle, payload.model || DEFAULT_MODEL);
    conversationId = conv.id;
  }
  const initResponse = await apiFetch("/chat/init", {
    method: "POST",
    body: JSON.stringify({ ...payload, conversation_id: conversationId, stream: true, init_only: true }),
  });
  if (!initResponse.ok) return initResponse;
  const init = await initResponse.json();
  const taskId = Number(init?.task_id || init?.assistant_message?.generation_task_id || 0);
  if (!taskId) {
    return new Response(JSON.stringify(init), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return apiFetch(`/tasks/${taskId}/stream?after=0`);
}

const fetchFileStatus = async (publicId: string): Promise<FileStatus> => {
  const res = await apiFetch(`/files/${publicId}`);
  if (!res.ok) throw await readApiError(res);
  return res.json();
};

const fetchDocumentArtifacts = async (kind: ArtifactKind): Promise<DocumentArtifact[]> => {
  const params = new URLSearchParams({ kind });
  const res = await apiFetch(`/document-artifacts?${params.toString()}`);
  if (!res.ok) throw await readApiError(res);
  const data = await res.json();
  return Array.isArray(data.artifacts) ? data.artifacts : [];
};

const createDocumentArtifact = async (artifact: {
  filePublicId: string;
  kind: ArtifactKind;
  title: string;
  summary?: string;
  payload: any;
  raw?: string;
}): Promise<DocumentArtifact> => {
  const res = await apiFetch("/document-artifacts", {
    method: "POST",
    body: JSON.stringify({
      file_public_id: artifact.filePublicId,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      payload: artifact.payload,
      raw: artifact.raw,
    }),
  });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json();
};

const deleteDocumentArtifact = async (id: number): Promise<void> => {
  const res = await apiFetch(`/document-artifacts/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await readApiError(res);
  }
};

async function waitForFileParsed(publicId: string, maxAttempts = 20): Promise<FileStatus | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const data = await fetchFileStatus(publicId);
    if (data.parse_status === "done") return data;
    if (data.parse_status === "error" || data.parse_status === "unsupported") {
      throw normalizeError(data.error_message || "Document parsing failed", {
        module: "file",
        fallbackMessage: "文档解析失败，请重新上传或换一个文件。",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Invalid JSON output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeGraphResult(data: any, raw: string): KnowledgeGraphResult {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  return {
    title: data.title || data.document_title || "Knowledge Graph",
    topics: Array.isArray(data.topics) ? data.topics : Array.isArray(data.main_topics) ? data.main_topics : [],
    nodes: nodes.map((node: any, index: number) => ({
      id: String(node.id || node.label || node.name || `n${index + 1}`),
      label: String(node.label || node.name || node.id || `Node ${index + 1}`),
      type: node.type || node.entity_type,
      group: node.group || node.topic,
      description: node.description || "",
      importance: Number(node.importance || 3),
    })),
    edges: edges.map((edge: any) => ({
      source: String(edge.source || ""),
      target: String(edge.target || ""),
      label: edge.label || edge.relation || "Relation",
      weight: Number(edge.weight || 3),
      confidence: edge.confidence || "medium",
      evidence: edge.evidence || "",
    })).filter((edge: KnowledgeGraphEdge) => edge.source && edge.target),
    summary: Array.isArray(data.summary) ? data.summary : Array.isArray(data.insights) ? data.insights : [],
    raw,
  };
}

function safeText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join("；");
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .map(([key, val]) => {
        const text = safeText(val);
        return text ? `${key}：${text}` : "";
      })
      .filter(Boolean);
    return parts.join("；");
  }
  return "";
}

function safeTextArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeText).map((item) => item.trim()).filter(Boolean);
}

function normalizeInfographicResult(data: any, raw: string): InfographicResult {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const style = data.style_recommendation && typeof data.style_recommendation === "object" && !Array.isArray(data.style_recommendation)
    ? data.style_recommendation
    : {};

  return {
    title: safeText(data.title) || "Infographic",
    subtitle: safeText(data.subtitle),
    summary: safeText(data.summary || data.one_sentence_summary),
    sections: sections.map((section: any, index: number) => ({
      section_title: safeText(section?.section_title || section?.title || section?.name) || `Section ${index + 1}`,
      section_purpose: safeText(section?.section_purpose || section?.purpose),
      key_points: safeTextArray(section?.key_points || section?.points),
      data_points: safeTextArray(section?.data_points || section?.data),
      visual_type: safeText(section?.visual_type || section?.chart_type) || "Card",
      priority: safeText(section?.priority),
    })),
    highlights: safeTextArray(Array.isArray(data.highlights) ? data.highlights : data.data_highlights),
    keywords: safeTextArray(data.keywords),
    style_recommendation: {
      tone: safeText(style.tone),
      layout: safeText(style.layout),
      color_theme: safeText(style.color_theme),
      icon_style: safeText(style.icon_style),
    },
    ready_to_design_copy: safeText(data.ready_to_design_copy || data.final_ready_to_design_copy),
    raw,
  };
}


function escapeTooltipHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

type KnowledgeGraphPreviewProps = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
};

const KNOWLEDGE_GRAPH_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#6366f1", "#64748b"];
const KNOWLEDGE_GRAPH_HEIGHT = 560;

const KnowledgeGraphPreview = memo(function KnowledgeGraphPreview({ nodes, edges }: KnowledgeGraphPreviewProps) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);

  const { graphOption, visualEdgeCount } = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const nodeLabelMap = new Map(nodes.map((node) => [node.id, node.label || node.id]));
    const groups = Array.from(new Set(nodes.map((node) => node.group || node.type || "Entity")));
    const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const denseGraph = nodes.length > 80;

    return {
      visualEdgeCount: validEdges.length,
      graphOption: {
        backgroundColor: "transparent",
        color: KNOWLEDGE_GRAPH_COLORS,
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: "rgba(255,255,255,0.96)",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 10,
          textStyle: { color: "#0f172a", fontSize: 12 },
          formatter: (params: any) => {
            const data = params.data || {};
            if (params.dataType === "edge") {
              return `<div style="width:220px;max-width:220px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">
                <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${escapeTooltipHtml(t("docReader.graph.tooltip.edge"))}</div>
                <div style="font-weight:600;color:#0f172a;line-height:20px;white-space:normal">${escapeTooltipHtml(data.sourceLabel)}</div>
                <div style="margin:4px 0;color:#2563eb;font-weight:600;white-space:normal">→ ${escapeTooltipHtml(data.label || "Relation")} →</div>
                <div style="font-weight:600;color:#0f172a;line-height:20px;white-space:normal">${escapeTooltipHtml(data.targetLabel)}</div>
              </div>`;
            }
            return `<div style="width:240px;max-width:240px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">
              <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${escapeTooltipHtml(t("docReader.graph.tooltip.node"))}</div>
              <div style="font-size:13px;font-weight:700;color:#0f172a;line-height:20px;white-space:normal">${escapeTooltipHtml(data.name || data.label || "Entity")}</div>
              ${data.type ? `<div style="margin-top:4px;color:#64748b;white-space:normal">${escapeTooltipHtml(data.type)}</div>` : ""}
              ${data.description ? `<div style="margin-top:6px;color:#475569;line-height:18px;white-space:normal">${escapeTooltipHtml(data.description)}</div>` : ""}
            </div>`;
          },
        },
        legend: groups.length > 1 ? {
          top: 14,
          left: 16,
          type: "scroll",
          itemWidth: 9,
          itemHeight: 9,
          textStyle: { color: "#64748b", fontSize: 11 },
          data: groups,
        } : undefined,
        series: [
          {
            type: "graph",
            layout: "force",
            roam: true,
            draggable: true,
            top: groups.length > 1 ? 48 : 18,
            left: 18,
            right: 18,
            bottom: 18,
            edgeSymbol: ["none", "arrow"],
            edgeSymbolSize: [0, 8],
            force: {
              repulsion: denseGraph ? 360 : 520,
              gravity: denseGraph ? 0.11 : 0.08,
              edgeLength: denseGraph ? [70, 135] : [95, 175],
              friction: 0.35,
              layoutAnimation: true,
            },
            categories: groups.map((group) => ({ name: group })),
            label: {
              show: nodes.length <= 80,
              position: "right",
              formatter: (params: any) => String(params.data?.label || params.data?.name || "").slice(0, 18),
              color: "#111827",
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: "rgba(255,255,255,0.78)",
              borderRadius: 5,
              padding: [2, 4],
            },
            lineStyle: {
              color: "#94a3b8",
              width: 1.1,
              opacity: 0.45,
              curveness: 0.08,
            },
            emphasis: {
              focus: "adjacency",
              lineStyle: { width: 2, opacity: 0.9 },
              label: { show: true },
            },
            data: nodes.map((node) => {
              const groupName = node.group || node.type || "Entity";
              const importance = Number(node.importance) || 3;
              return {
                id: node.id,
                name: node.label || node.id,
                label: node.label || node.id,
                type: node.type || "Entity",
                group: groupName,
                description: node.description || "",
                category: Math.max(0, groups.indexOf(groupName)),
                symbolSize: Math.max(24, Math.min(48, 22 + importance * 5)),
                itemStyle: {
                  borderColor: "#ffffff",
                  borderWidth: 2,
                  shadowBlur: 10,
                  shadowColor: "rgba(15, 23, 42, 0.12)",
                },
              };
            }),
            links: validEdges.map((edge) => ({
              source: edge.source,
              target: edge.target,
              label: edge.label || "Relation",
              sourceLabel: nodeLabelMap.get(edge.source) || edge.source,
              targetLabel: nodeLabelMap.get(edge.target) || edge.target,
              value: edge.label || "Relation",
              lineStyle: {
                width: edge.confidence === "high" ? 1.6 : 1,
                opacity: edge.confidence === "high" ? 0.62 : 0.42,
              },
            })),
          },
        ],
      },
    };
  }, [nodes, edges, t]);

  useEffect(() => {
    setReady(false);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [graphOption]);

  return (
    <div id="artifact-visualization-section" className="rounded-2xl border border-surface-border bg-surface-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-text-primary">{t("docReader.visual.preview")}</p>
          <p className="mt-1 text-[11px] text-text-tertiary">{t("docReader.graph.previewDesc")}</p>
        </div>
        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] text-brand">{formatI18n(t("docReader.graph.stats"), { nodes: nodes.length, relations: visualEdgeCount })}</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl bg-surface-elevated">
        {ready ? (
          <ReactECharts
            option={graphOption}
            style={{ height: KNOWLEDGE_GRAPH_HEIGHT, width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
            lazyUpdate={true}
          />
        ) : (
          <ChartLoading className="h-[560px]" />
        )}
      </div>
    </div>
  );
});

type InfographicPreviewProps = {
  title: string;
  subtitle?: string;
  summary?: string;
  highlights: string[];
  sections: InfographicSection[];
};

const InfographicPreview = memo(function InfographicPreview({ title, subtitle, summary, highlights, sections }: InfographicPreviewProps) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [sections, t]);

  const { infographicOption, chartHeight } = useMemo(() => {
    const sectionNames = sections.map((section, index) => `${index + 1}. ${section.section_title || t("docReader.infographic.module")}`);
    const sectionScores = sections.map((section) => Math.max(1, (section.key_points?.length || 0) + (section.data_points?.length || 0) + (section.section_purpose ? 1 : 0)));

    return {
      chartHeight: Math.max(300, sections.length * 42 + 80),
      infographicOption: {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: "rgba(255,255,255,0.98)",
          borderColor: "rgba(226,232,240,0.96)",
          borderWidth: 1,
          padding: [10, 12],
          extraCssText: "width:280px;max-width:280px;white-space:normal;border-radius:14px;box-shadow:0 18px 45px rgba(15,23,42,0.14);backdrop-filter:blur(10px);overflow-wrap:anywhere;word-break:break-word;",
          textStyle: {
            color: "#334155",
            fontSize: 12,
            lineHeight: 18,
          },
          formatter: (params: any) => {
            const index = Array.isArray(params) ? params[0]?.dataIndex : params?.dataIndex;
            const section = sections[index] || {};
            const points = Array.isArray(section.key_points) ? section.key_points.slice(0, 3) : [];
            return `<div style="width:256px;max-width:256px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">
              <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;white-space:normal">${escapeTooltipHtml(t("docReader.infographic.tooltip.module"))}</div>
              <div style="font-size:13px;font-weight:700;color:#0f172a;line-height:20px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">${escapeTooltipHtml(section.section_title || t("docReader.infographic.module"))}</div>
              ${section.section_purpose ? `<div style="margin-top:6px;color:#475569;line-height:18px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">${escapeTooltipHtml(section.section_purpose)}</div>` : ""}
              ${points.length ? `<div style="margin-top:8px;color:#64748b;line-height:18px;white-space:normal;overflow-wrap:anywhere;word-break:break-word">${points.map((point) => `<div style="white-space:normal;overflow-wrap:anywhere;word-break:break-word">• ${escapeTooltipHtml(point)}</div>`).join("")}</div>` : ""}
            </div>`;
          },
        },
        grid: {
          top: 18,
          right: 28,
          bottom: 24,
          left: 118,
        },
        xAxis: {
          type: "value",
          show: false,
        },
        yAxis: {
          type: "category",
          inverse: true,
          data: sectionNames,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#64748b",
            fontSize: 11,
            width: 104,
            overflow: "truncate",
          },
        },
        series: [
          {
            type: "bar",
            data: sectionScores,
            barWidth: 14,
            itemStyle: {
              borderRadius: [0, 10, 10, 0],
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: "#60a5fa" },
                  { offset: 1, color: "#2563eb" },
                ],
              },
            },
            label: {
              show: true,
              position: "right",
              color: "#64748b",
              fontSize: 11,
              formatter: (params: any) => formatI18n(t("docReader.infographic.itemCount"), { count: params.value }),
            },
          },
        ],
      },
    };
  }, [sections]);

  return (
    <div id="artifact-visualization-section" className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-primary">{t("docReader.visual.preview")}</p>
          <p className="mt-1 text-[11px] text-text-tertiary">{t("docReader.infographic.previewDesc")}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] text-brand">{formatI18n(t("docReader.infographic.moduleCount"), { count: sections.length })}</span>
      </div>
      <div className="bg-surface-elevated p-4">
        <div className="rounded-2xl bg-surface-card p-5 shadow-sm">
          <div className="max-w-2xl">
            <p className="text-lg font-semibold leading-7 text-text-primary">{title || "Infographic"}</p>
            {(subtitle || summary) && (
              <p className="mt-2 text-xs leading-5 text-text-secondary">{subtitle || summary}</p>
            )}
          </div>
          {highlights.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
              {highlights.slice(0, 3).map((item, index) => (
                <div key={`visual-highlight-${index}`} className="rounded-2xl bg-brand/10 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand">{formatI18n(t("docReader.infographic.highlightLabel"), { index: index + 1 })}</p>
                  <p className="mt-1 text-xs leading-5 text-text-primary">{item}</p>
                </div>
              ))}
            </div>
          )}
          {sections.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-2xl bg-surface-elevated">
              {ready ? (
                <ReactECharts
                  option={infographicOption}
                  style={{ height: chartHeight, width: "100%" }}
                  opts={{ renderer: "canvas" }}
                  notMerge={true}
                  lazyUpdate={true}
                />
              ) : (
                <ChartLoading className="h-[300px]" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ─── page ─── */

export default function DocumentReaderPage() {
  const { t, language } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pdfViewportRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState<number>(0);
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfViewportWidth, setPdfViewportWidth] = useState(0);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [rightWidth, setRightWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("doc-reader-right-width");
      return saved ? parseInt(saved, 10) : 420;
    }
    return 420;
  });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(420);
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("study");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
  const [graphArtifacts, setGraphArtifacts] = useState<DocumentArtifact[]>([]);
  const [infographicArtifacts, setInfographicArtifacts] = useState<DocumentArtifact[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [infographicLoading, setInfographicLoading] = useState(false);
  const [artifactModal, setArtifactModal] = useState<DocumentArtifact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentArtifact | null>(null);
  const pdfPageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) || null, [files, activeFileId]);
  const pdfPageWidth = Math.max(320, Math.min(pdfViewportWidth - 64, 860)) * pdfScale;

  /* pdfjs worker setup */
  const [pdfWorkerReady, setPdfWorkerReady] = useState(false);
  useEffect(() => {
    import("react-pdf").then((mod) => {
      mod.pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs?v=5.4.296";
      setPdfWorkerReady(true);
    });
  }, []);

  /* right panel resize */
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(320, Math.min(720, resizeStartWidthRef.current + delta));
      rightWidthRef.current = newWidth;
      setRightWidth(newWidth);
    };
    const handleUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("doc-reader-right-width", String(rightWidthRef.current));
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const el = pdfViewportRef.current;
    if (!el) return;

    const updateWidth = () => setPdfViewportWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollToPdfPage = useCallback((page: number) => {
    setPdfPage(page);
    requestAnimationFrame(() => {
      pdfPageRefs.current[page]?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = rightWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [rightWidth]);

  const handlePdfScroll = useCallback(() => {
    const viewport = pdfViewportRef.current;
    if (!viewport || pdfNumPages <= 0) return;

    const viewportTop = viewport.getBoundingClientRect().top;
    let nearestPage = pdfPage;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let page = 1; page <= pdfNumPages; page++) {
      const node = pdfPageRefs.current[page];
      if (!node) continue;
      const distance = Math.abs(node.getBoundingClientRect().top - viewportTop - 24);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = page;
      }
    }

    if (nearestPage !== pdfPage) setPdfPage(nearestPage);
  }, [pdfNumPages, pdfPage]);

  /* load persisted files, conversation & history messages */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FILES);
      if (raw) {
        const savedFiles = JSON.parse(raw) as DocFile[];
        setFiles(
          savedFiles
            .filter((file) => file.url && !file.url.startsWith("blob:"))
            .map((file) => ({
              ...file,
              url: file.url.replace(/\/download$/, "/view"),
            }))
        );
      }
    } catch {
      // ignore
    }

    const convRaw = localStorage.getItem(STORAGE_KEY_CONV);
    const convId = convRaw ? Number(convRaw) : null;
    if (convId) {
      setConversationId(convId);
      // load history messages
      apiFetch(`/conversations/${convId}/messages`)
        .then(async (res) => {
          if (!res.ok) throw await readApiError(res);
          return res.json();
        })
        .then((data: any) => {
          if (data.messages && Array.isArray(data.messages)) {
            const loaded: ChatMsg[] = data.messages
              .filter((m: any) => m.role !== "system")
              .map((m: any) => ({
                id: String(m.id),
                role: m.role,
                content: typeof m.content === "string" ? m.content : String(m.content || ""),
                model: m.model,
                createdAt: new Date(m.created_at).getTime(),
                isStreaming: false,
              }));
            setMessages(loaded);
          }
        })
        .catch(() => {
          // ignore load errors
        });
    }
  }, []);

  /* persist files */
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    if (conversationId) localStorage.setItem(STORAGE_KEY_CONV, String(conversationId));
  }, [conversationId]);

  const refreshArtifacts = useCallback(async () => {
    const [graphs, infographics] = await Promise.all([
      fetchDocumentArtifacts("knowledge_graph"),
      fetchDocumentArtifacts("infographic"),
    ]);
    setGraphArtifacts(graphs);
    setInfographicArtifacts(infographics);
  }, []);

  useEffect(() => {
    void refreshArtifacts().catch(() => {
      setGraphArtifacts([]);
      setInfographicArtifacts([]);
    });
  }, [refreshArtifacts]);

  const refreshFileStatus = useCallback(async (publicId: string) => {
    const data = await fetchFileStatus(publicId);
    setFiles((prev) =>
      prev.map((item) =>
        item.publicId === publicId
          ? {
              ...item,
              parseStatus: data.parse_status || item.parseStatus,
              errorMessage: data.parse_status === "done"
                ? undefined
                : docFileError(data.error_message || item.errorMessage, "文档解析失败，请重新上传或换一个文件。"),
              pageCount: data.page_count || item.pageCount,
            }
          : item
      )
    );
    return data;
  }, []);

  useEffect(() => {
    const candidates = files.filter(
      (file) => file.publicId && file.parseStatus !== "done" && file.parseStatus !== "unsupported"
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const refreshAll = async () => {
      for (const file of candidates) {
        try {
          const data = await fetchFileStatus(file.publicId);
          if (cancelled) return;
          setFiles((prev) =>
            prev.map((item) =>
              item.publicId === file.publicId
                ? {
                    ...item,
                    parseStatus: data.parse_status || item.parseStatus,
                    errorMessage: data.parse_status === "done"
                      ? undefined
                      : docFileError(data.error_message || item.errorMessage, "文档解析失败，请重新上传或换一个文件。"),
                    pageCount: data.page_count || item.pageCount,
                  }
                : item
            )
          );
        } catch {
          // keep local state; retry later
        }
      }
    };

    void refreshAll();
    const timer = window.setInterval(refreshAll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [files]);

  /* auto-scroll chat */
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  /* upload file */
  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error(t("docReader.error.pdfOnly"));
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await apiFetch("/files/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();
        const newFile: DocFile = {
          id: generateId(),
          name: file.name,
          publicId: data.public_id,
          size: file.size,
          type: file.type || "application/pdf",
          uploadedAt: new Date().toISOString(),
          url: `/api/files/${data.public_id}/view`,
          parseStatus: data.parse_status || "pending",
          errorMessage: data.error_message
            ? docFileError(data.error_message, t("docReader.error.parse"))
            : undefined,
        };
        setFiles((prev) => [newFile, ...prev]);
        setActiveFileId(newFile.id);
        toast.success(t("docReader.success.upload"));

        // auto-trigger summary after backend parsing is ready
        void (async () => {
          try {
            const status = await waitForFileParsed(newFile.publicId);
            if (!status || status.parse_status !== "done") {
              setFiles((prev) =>
                prev.map((item) =>
                  item.publicId === newFile.publicId
                    ? { ...item, parseStatus: "parsing", errorMessage: undefined }
                    : item
                )
              );
              return;
            }
            setFiles((prev) =>
              prev.map((item) =>
                item.publicId === newFile.publicId
                  ? { ...item, parseStatus: "done", errorMessage: undefined, pageCount: status.page_count || item.pageCount }
                  : item
              )
            );
            triggerSummary(newFile.publicId, newFile.name);
          } catch (err) {
            const userMessage = docFileError(err, t("docReader.error.parse"));
            setFiles((prev) =>
              prev.map((item) =>
                item.publicId === newFile.publicId
                  ? { ...item, parseStatus: "error", errorMessage: userMessage }
                  : item
              )
            );
            toast.error(userMessage);
          }
        })();
      } catch (e) {
        showUserError(e, { module: "file", fallbackTitle: t("docReader.error.upload"), fallbackMessage: t("docReader.error.upload") });
      } finally {
        setUploading(false);
      }
    },
    [t]
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
    e.target.value = "";
  };

  const openUploadDialog = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  };

  /* remove file */
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (activeFileId === id) {
      setActiveFileId(null);
      setPdfPage(1);
      setPdfNumPages(0);
    }
  };

  /* start new chat session */
  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setActiveHistoryId(null);
    localStorage.removeItem(STORAGE_KEY_CONV);
    setInputText("");
  };

  const loadHistoryList = useCallback(async (silent = false) => {
    if (!readAuthState().user) return;
    if (!silent) setHistoryLoading(true);
    try {
      const data = await apiJson<any>(`/conversations?skill_key=${SKILL_KEY}&limit=100`);
      setHistory(data.conversations || []);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  const loadHistoryConversation = useCallback(async (id: number) => {
    if (!readAuthState().user) return;
    try {
      const data = await apiJson<any>(`/conversations/${id}/messages`);
      const loaded: ChatMsg[] = (data.messages || [])
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: typeof m.content === "string" ? m.content : String(m.content || ""),
          model: m.model,
          createdAt: new Date(m.created_at).getTime(),
          isStreaming: false,
        }));
      setMessages(loaded);
      setConversationId(id);
      setActiveHistoryId(id);
      localStorage.setItem(STORAGE_KEY_CONV, String(id));
    } catch (err) {
      console.error("load document study history failed", err);
    }
  }, []);

  const deleteHistoryItem = useCallback(async (id: number) => {
    if (!readAuthState().user) return;
    try {
      const res = await apiFetch(`/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (conversationId === id) {
        setMessages([]);
        setConversationId(null);
        setActiveHistoryId(null);
        localStorage.removeItem(STORAGE_KEY_CONV);
      }
      toast.success(t("docReader.success.deleted"));
    } catch (err) {
      console.error("delete document study history failed", err);
    }
  }, [conversationId]);

  const dateCacheRef = useRef(new Map<string, string>());
  const formatDate = useCallback((iso: string) => {
    const cached = dateCacheRef.current.get(iso);
    if (cached) return cached;
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    let result: string;
    if (diff < 86400000 && d.getDate() === now.getDate()) {
      result = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } else if (diff < 172800000 && d.getDate() === now.getDate() - 1) {
      result = t("common.yesterday");
    } else {
      result = d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    }
    dateCacheRef.current.set(iso, result);
    return result;
  }, []);

  useEffect(() => {
    loadHistoryList();

    const refresh = () => loadHistoryList();
    window.addEventListener("conversation-created", refresh);
    return () => window.removeEventListener("conversation-created", refresh);
  }, [loadHistoryList]);

  /* clear chat history (keep conversation id for backend continuity) */
  const clearChat = () => {
    setMessages([]);
    setInputText("");
  };

  /* send message */
  const sendChat = useCallback(
    async (content: string, fileIds?: string[]) => {
      if (!content.trim() || isLoading) return;

      const userMsg: ChatMsg = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputText("");
      setIsLoading(true);

      try {
        let convId = conversationId;
        if (readAuthState().user && !convId) {
          const conv = await createConversation(content.trim().slice(0, 30), DEFAULT_MODEL);
          convId = conv.id;
          setConversationId(convId);
          setActiveHistoryId(convId);
        }

        const assistantId = generateId();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "", createdAt: Date.now(), isStreaming: true },
        ]);

        const historyMessages = messages
          .filter((m) => m.content.trim() && !m.isStreaming)
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content }));

        const targetLanguage = LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en;
        const systemPrompt = `You are a professional multilingual AI study assistant for document reading, translation, summarization, extraction, knowledge graph reasoning, and infographic-ready content planning.

【Task】
Answer the user's request based on the uploaded or selected document content.

${buildLanguageConfigPrompt(targetLanguage, "markdown")}

【Answer Rules】
1. Prioritize document-grounded answers. If the document does not contain enough information, explicitly say that it cannot be determined from the document.
2. Separate task actions clearly: summarize, extract, classify, translate, localize, preserve, normalize, compare, infer. Do not mix translation and summarization unless the user asks for both.
3. Use the target_language for the main answer. Keep quoted source evidence in the original language.
4. For professional terms, names, acronyms, organizations, laws, models, datasets, methods, and product names: keep the original on first occurrence and add a target-language explanation when useful.
5. Structure the answer for fast reading. Use headings, bullet points, tables, or numbered lists when appropriate.
6. Do not fabricate missing content. Clearly mark uncertain items as unclear, uncertain, or needs_review.`;

        const payload: any = {
          model: DEFAULT_MODEL,
          stream: true,
          search: false,
          reasoning: false,
          conversation_id: convId,
          skill_key: SKILL_KEY,
          messages: [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: content.trim() },
          ],
        };
        if (fileIds && fileIds.length > 0) {
          payload.file_ids = fileIds;
          payload.message_file_ids = fileIds;
        }

        const res = await fetchDocumentReaderChatStream(payload);

        if (!res.ok) {
          throw await readApiError(res);
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream") || !res.body) {
          const data = await res.json();
          const text = extractTextFromChatResponse(data);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text, isStreaming: false } : m))
          );
          return;
        }

        let taskId: number | null = null;
        let fullText = "";
        let pendingText = "";
        let rafId: number | null = null;

        const updateStreamingText = (text: string) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
          );
        };

        const flushPending = () => {
          rafId = null;
          if (!pendingText) return;
          updateStreamingText(pendingText);
          pendingText = "";
        };

        const flushFinalText = (text = fullText) => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          pendingText = "";
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text, isStreaming: false } : m))
          );
        };

        const updateHistoryAfterCompletion = () => {
          if (!convId) return;
          setHistory((prev) => {
            const idx = prev.findIndex((h) => h.id === convId);
            if (idx !== -1) {
              const updated = { ...prev[idx], updated_at: new Date().toISOString() };
              return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
            }
            return [
              {
                id: convId,
                title: content.trim().slice(0, 30) || t("docReader.defaultTitle"),
                model: DEFAULT_MODEL,
                message_count: 1,
                updated_at: new Date().toISOString(),
              },
              ...prev,
            ];
          });
        };

        const recoverFromTask = async () => {
          if (!taskId) return null;
          const taskRes = await apiFetch(`/tasks/${taskId}`);
          if (!taskRes.ok) return null;
          const data = await taskRes.json();
          const task = data?.task || {};
          const message = data?.message || {};
          const recovered = task.result || message.content || "";
          if ((task.status === "completed" || message.completed_at) && recovered) {
            return recovered;
          }
          if (["failed", "cancelled", "incomplete"].includes(task.status)) {
            throw normalizeError(task.error_message || t("docReader.error.send"), {
              module: "chat",
              fallbackMessage: t("docReader.error.send"),
            });
          }
          return null;
        };

        const recoverFromConversation = async () => {
          if (!convId) return null;
          const messageRes = await apiFetch(`/conversations/${convId}/messages`);
          if (!messageRes.ok) return null;
          const data = await messageRes.json();
          const savedMessages = Array.isArray(data?.messages) ? data.messages : [];
          const latestAssistant = [...savedMessages].reverse().find((msg: any) => msg?.role === "assistant" && msg?.content && msg?.completed_at);
          return latestAssistant?.content || null;
        };

        const recoverCompletedResult = async () => {
          for (let attempt = 0; attempt < 15; attempt += 1) {
            const recovered = (await recoverFromTask()) || (await recoverFromConversation());
            if (recovered) return recovered;
            await sleep(800);
          }
          return null;
        };

        try {
          const finalText = await consumeChatStream(res, {
            onDelta: (delta) => {
              fullText += delta;
              updateStreamingText(fullText);
            },
            onMeta: (meta) => {
              taskId = taskId || extractGenerationTaskId(meta);
            },
          });
          fullText = finalText || fullText;
          flushFinalText(fullText);
          updateHistoryAfterCompletion();
        } catch (err) {
          const recovered = await recoverCompletedResult();
          if (recovered) {
            fullText = recovered;
            flushFinalText(recovered);
            updateHistoryAfterCompletion();
            return;
          }
          const userMessage = docChatError(err, t("docReader.error.send"));
          flushFinalText(fullText || `${t("docReader.error.prefix")}${userMessage}`);
          throw err;
        }
      } catch (e) {
        const userMessage = docChatError(e, t("docReader.error.send"));
        toast.error(userMessage);
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.isStreaming
              ? { ...m, content: m.content || `${t("docReader.error.prefix")}${userMessage}`, isStreaming: false }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, isLoading]
  );

  /* trigger summary */
  const triggerSummary = useCallback(
    (publicId: string, filename: string) => {
      const targetLanguage = LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en;
      const prompt = `Task: summarize_document
Document: 「${filename}」

${buildLanguageConfigPrompt(targetLanguage, "markdown")}

Output requirements:
1. Identify the document language.
2. Provide a one-paragraph executive summary in target_language.
3. List 3-5 core points.
4. Extract key facts, numbers, dates, conclusions, and limitations.
5. Mark risks, open questions, or action items if they are supported by the document.
6. Preserve proper nouns, acronyms, and quoted evidence according to the multilingual rules.`;
      sendChat(prompt, [publicId]);
    },
    [language, sendChat]
  );

  const ensureActiveFileReady = useCallback(async () => {
    if (!activeFile) {
      toast.info(t("docReader.warn.uploadFirst"));
      return null;
    }

    if (activeFile.parseStatus !== "done") {
      try {
        const status = await refreshFileStatus(activeFile.publicId);
        if (status.parse_status !== "done") {
          toast.info(t("docReader.warn.parsing"));
          return null;
        }
      } catch {
        toast.info(t("docReader.warn.parsing"));
        return null;
      }
    }

    return activeFile;
  }, [activeFile, refreshFileStatus]);

  const generateDocumentVisualization = useCallback(
    async (prompt: string, file: DocFile) => {
      const payload: any = {
        model: DEFAULT_MODEL,
        stream: true,
        transient: true,
        search: false,
        reasoning: false,
        skill_key: SKILL_KEY,
        file_ids: [file.publicId],
        message_file_ids: [file.publicId],
        messages: [
          {
            role: "system",
            content: `You are a multilingual document visualization data extraction assistant.

${buildLanguageConfigPrompt(LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en, "json")}

Strict output rules:
1. Return valid JSON only. Do not output Markdown, code fences, comments, or explanatory text.
2. Keep all JSON keys exactly as specified by the user schema in English.
3. Write all JSON string values in target_language unless a field explicitly requires original evidence.
4. Keep evidence quotes in the original document language.
5. Do not invent unsupported nodes, relations, sections, data points, or visual claims.`,
          },
          { role: "user", content: prompt },
        ],
      };

      const res = await fetchDocumentReaderChatStream(payload);
      if (!res.ok) {
        throw await readApiError(res);
      }

      let fullText = "";
      await consumeChatStream(res, {
        onDelta: (delta) => {
          fullText += delta;
        },
        onError: (err) => {
          throw err;
        },
      });
      return fullText.trim();
    },
    [language]
  );

  const generateKnowledgeGraph = useCallback(async () => {
    const file = await ensureActiveFileReady();
    if (!file || graphLoading) return;
    setRightTab("graph");
    setGraphLoading(true);
    try {
      const targetLanguage = LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en;
      const prompt = `Task: extract_multilingual_knowledge_graph
Document: 「${file.name}」

${buildLanguageConfigPrompt(targetLanguage, "json")}

Return valid JSON only. Use this exact schema with fixed English keys:
{
  "title": "",
  "source_language": "",
  "target_language": "${targetLanguage}",
  "topics": [],
  "nodes": [
    {
      "id": "n1",
      "label": "localized entity label in target_language",
      "name_original": "canonical entity name from source document",
      "name_localized": "entity name or explanation in target_language",
      "type": "Person/Organization/Concept/Technology/Method/Product/Event/Policy/Location/Time/Metric/Risk/Opportunity",
      "aliases": [],
      "group": "localized topic group",
      "description": "brief localized description grounded in the document",
      "importance": 1,
      "disambiguation_note": ""
    }
  ],
  "edges": [
    {
      "source": "n1",
      "target": "n2",
      "label": "localized relation type in target_language",
      "relation_original": "relation wording from the source document when available",
      "weight": 1,
      "confidence": "high/medium/low",
      "evidence": "original-language source evidence"
    }
  ],
  "summary": [],
  "terminology": [
    {
      "original": "",
      "localized": "",
      "note": ""
    }
  ]
}

Knowledge graph rules:
- Extract 15-40 nodes and 20-80 edges when the document has enough information.
- Entity names must be normalized; merge aliases and repeated references.
- Preserve original canonical names in name_original; use target_language for label, name_localized, group, description, and relation labels.
- Remove duplicate, weak, irrelevant, or unsupported relations.
- Do not output relations without evidence. Mark inferred or ambiguous relations as confidence=low.
- If cross-language names may refer to different entities, fill disambiguation_note.
- Output JSON only. No Markdown. No code fences.`;
      const raw = await generateDocumentVisualization(prompt, file);
      const data = extractJsonObject(raw);
      const result = normalizeGraphResult(data, raw);
      const artifact = await createDocumentArtifact({
        filePublicId: file.publicId,
        kind: "knowledge_graph",
        title: result.title || "Knowledge Graph",
        summary: result.summary?.join("；"),
        payload: result,
        raw,
      });
      setGraphArtifacts((prev) => [artifact, ...prev]);
      toast.success(t("docReader.success.graph"));
    } catch (err) {
      toast.error(docChatError(err, t("docReader.error.graphGenerate")));
    } finally {
      setGraphLoading(false);
    }
  }, [ensureActiveFileReady, generateDocumentVisualization, graphLoading]);

  const generateInfographic = useCallback(async () => {
    const file = await ensureActiveFileReady();
    if (!file || infographicLoading) return;
    setRightTab("infographic");
    setInfographicLoading(true);
    try {
      const targetLanguage = LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en;
      const prompt = `Task: create_multilingual_infographic_content
Document: 「${file.name}」

${buildLanguageConfigPrompt(targetLanguage, "json")}

Return valid JSON only. Use this exact schema with fixed English keys:
{
  "title": "",
  "subtitle": "",
  "source_language": "",
  "target_language": "${targetLanguage}",
  "summary": "",
  "sections": [
    {
      "section_title": "short localized title",
      "section_purpose": "why this module matters",
      "key_points": [],
      "data_points": [],
      "visual_type": "timeline/process/comparison/map/bar_chart/relation_graph/cards",
      "priority": "high/medium/low"
    }
  ],
  "highlights": [],
  "keywords": [],
  "terminology": [
    {
      "original": "",
      "localized": "",
      "note": ""
    }
  ],
  "style_recommendation": {
    "tone": "",
    "layout": "",
    "color_theme": "",
    "icon_style": ""
  },
  "ready_to_design_copy": ""
}

Infographic rules:
- Create 4-7 sections. Each section should have no more than 5 key_points.
- Compress long text into short titles, short labels, and short explanations suitable for visual display.
- Preserve key numbers, dates, causal relationships, contrasts, conclusions, and limitations.
- If data exists, highlight the most visually meaningful data points.
- Make the copy understandable to non-expert readers while staying faithful to the document.
- Use target_language for all display copy. Keep original names/quotes in terminology or evidence-style fields when needed.
- Do not copy long passages. Do not invent content.
- Output JSON only. No Markdown. No code fences.`;
      const raw = await generateDocumentVisualization(prompt, file);
      const data = extractJsonObject(raw);
      const result = normalizeInfographicResult(data, raw);
      const artifact = await createDocumentArtifact({
        filePublicId: file.publicId,
        kind: "infographic",
        title: result.title || "Infographic",
        summary: result.summary,
        payload: result,
        raw,
      });
      setInfographicArtifacts((prev) => [artifact, ...prev]);
      toast.success(t("docReader.success.infographic"));
    } catch (err) {
      toast.error(docChatError(err, t("docReader.error.infographicGenerate")));
    } finally {
      setInfographicLoading(false);
    }
  }, [ensureActiveFileReady, generateDocumentVisualization, infographicLoading]);

  const handleDeleteArtifact = useCallback(async (artifact: DocumentArtifact, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setArtifactModal(null);
    setDeleteTarget(artifact);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteDocumentArtifact(deleteTarget.id);
      if (deleteTarget.kind === "knowledge_graph") {
        setGraphArtifacts((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      } else {
        setInfographicArtifacts((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      }
      toast.success(t("common.delete"));
    } catch {
      toast.error(t("common.delete") + t("common.failed"));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  /* quick actions */
  const targetLanguage = LANGUAGE_NAME_MAP[language] || LANGUAGE_NAME_MAP.en;
  const quickActionBase = buildLanguageConfigPrompt(targetLanguage, "markdown");
  const quickActions = [
    {
      label: t("docReader.action.summary"),
      icon: BookOpen,
      prompt: (name: string, pid: string) => `Task: summarize_document\nDocument: 「${name}」\n\n${quickActionBase}\n\nOutput: source language, one-sentence summary, detailed summary, 3-5 key points, key data, limitations, and terminology notes.`,
      fileIds: (pid: string) => [pid],
    },
    {
      label: t("docReader.action.data"),
      icon: BarChart3,
      prompt: (name: string, pid: string) => `Task: extract_key_data\nDocument: 「${name}」\n\n${quickActionBase}\n\nExtract all key numbers, metrics, dates, units, quantified conclusions, and limitations. Present them in a clear table using target_language for explanations. Keep original units and values exact.`,
      fileIds: (pid: string) => [pid],
    },
    {
      label: t("docReader.action.timeline"),
      icon: Clock,
      prompt: (name: string, pid: string) => `Task: extract_timeline\nDocument: 「${name}」\n\n${quickActionBase}\n\nExtract time-related events in chronological order. Preserve original dates, normalize dates only when unambiguous, and mark ambiguous dates as needs_review.`,
      fileIds: (pid: string) => [pid],
    },
    {
      label: t("docReader.action.translate"),
      icon: Globe,
      prompt: (name: string, pid: string) => `Task: translate_core_passages\nDocument: 「${name}」\n\n${quickActionBase}\n\nTranslate the core passages into target_language. Preserve meaning, tone, titles, tables, lists, numbers, dates, units, proper nouns, and acronyms. Add a terminology table with original/localized pairs.`,
      fileIds: (pid: string) => [pid],
    },
    {
      label: t("docReader.action.graph"),
      icon: Network,
      prompt: (name: string, pid: string) => `Task: explain_knowledge_graph\nDocument: 「${name}」\n\n${quickActionBase}\n\nGenerate a readable knowledge graph explanation: entity categories, normalized entities with original/localized names, relation table with original-language evidence, Mermaid graph TD code block, and key insights.`,
      fileIds: (pid: string) => [pid],
    },
    {
      label: t("docReader.action.infographic"),
      icon: ImageIcon,
      prompt: (name: string, pid: string) => `Task: plan_infographic\nDocument: 「${name}」\n\n${quickActionBase}\n\nCreate an infographic content plan: title, subtitle, 4-7 modules, key numbers, short visual labels, layout suggestions, style direction, and image-generation prompt in target_language.`,
      fileIds: (pid: string) => [pid],
    },
  ];

  /* welcome examples */
  const welcomeExamples = [
    { title: t("docReader.card.summary"), desc: t("docReader.card.summaryDesc"), prompt: `Task: summarize_document\n\n${quickActionBase}\n\nSummarize the document's core content in target_language.` },
    { title: t("docReader.card.extractData"), desc: t("docReader.card.extractDataDesc"), prompt: `Task: extract_key_data\n\n${quickActionBase}\n\nExtract key data, metrics, dates, and quantified conclusions from the document.` },
    { title: t("docReader.card.analyzeRisk"), desc: t("docReader.card.analyzeRiskDesc"), prompt: `Task: analyze_risks_and_opportunities\n\n${quickActionBase}\n\nAnalyze risks and opportunities explicitly mentioned or directly supported by the document.` },
    { title: t("docReader.card.faq"), desc: t("docReader.card.faqDesc"), prompt: `Task: generate_faq\n\n${quickActionBase}\n\nGenerate 5 frequently asked questions and answers based only on the document content.` },
  ];

  const tabs: { key: RightTab; label: string; icon: any }[] = [
    { key: "study", label: t("docReader.tab.study"), icon: MessageSquare },
    { key: "graph", label: t("docReader.tab.graph"), icon: Network },
    { key: "infographic", label: t("docReader.tab.infographic"), icon: ImageIcon },
  ];


  const renderArtifactCards = (artifacts: DocumentArtifact[], icon: any) => {
    const Icon = icon;
    return (
      <div className="space-y-3">
        {artifacts.map((artifact) => {
          const payload = artifact.payload || {};
          const nodeCount = Array.isArray(payload.nodes) ? payload.nodes.length : undefined;
          const edgeCount = Array.isArray(payload.edges) ? payload.edges.length : undefined;
          const sectionCount = Array.isArray(payload.sections) ? payload.sections.length : undefined;
          const meta = artifact.kind === "knowledge_graph"
            ? `${nodeCount ?? 0} ${t("docReader.stats.nodes")} · ${edgeCount ?? 0} ${"Relation"}`
            : `${sectionCount ?? 0} ${t("docReader.stats.sections")} · ${Array.isArray(payload.highlights) ? payload.highlights.length : 0} ${t("docReader.stats.highlights")}`;
          return (
            <div
              key={artifact.id}
              role="button"
              tabIndex={0}
              onClick={() => setArtifactModal(artifact)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setArtifactModal(artifact);
              }}
              className="group w-full cursor-pointer rounded-2xl border border-surface-border bg-surface-card p-4 text-left transition hover:border-brand/40 hover:bg-surface-elevated"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary">{artifact.title || (artifact.kind === "knowledge_graph" ? "Knowledge Graph" : "Infographic")}</p>
                      <FileJson className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition group-hover:text-brand" />
                    </div>
                    <button
                      type="button"
                      onClick={(event) => handleDeleteArtifact(artifact, event)}
                      className="shrink-0 rounded-md p-1 text-text-tertiary opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {artifact.summary && (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{artifact.summary}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
                    <span className="rounded-full bg-surface-elevated px-2 py-1">{meta}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2 py-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(artifact.updated_at || artifact.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderArtifactModalContent = (artifact: DocumentArtifact) => {
    const payload = artifact.payload || {};
    if (artifact.kind === "knowledge_graph") {
      const nodes: KnowledgeGraphNode[] = Array.isArray(payload.nodes) ? payload.nodes : [];
      const edges: KnowledgeGraphEdge[] = Array.isArray(payload.edges) ? payload.edges : [];
      const summary: string[] = Array.isArray(payload.summary) ? payload.summary : [];
      const visibleNodes = nodes.slice(0, 30);
      const visibleEdges = edges.slice(0, 40);
      const nodeLabelMap = new Map(nodes.map((node) => [node.id, node.label]));
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-elevated p-3">
              <p className="text-lg font-semibold text-text-primary">{nodes.length}</p>
              <p className="text-[11px] text-text-tertiary">{t("docReader.graph.entityNodes")}</p>
            </div>
            <div className="rounded-xl bg-surface-elevated p-3">
              <p className="text-lg font-semibold text-text-primary">{edges.length}</p>
              <p className="text-[11px] text-text-tertiary">{t("docReader.graph.edges")}</p>
            </div>
          </div>

          {Array.isArray(payload.topics) && payload.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {payload.topics.map((topic: string) => (
                <span key={topic} className="rounded-full bg-brand/10 px-2 py-1 text-[11px] text-brand">{topic}</span>
              ))}
            </div>
          )}

          {nodes.length > 0 && <KnowledgeGraphPreview nodes={nodes} edges={edges} />}

          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <p className="text-xs font-semibold text-text-primary">{t("docReader.graph.coreEntities")}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {visibleNodes.map((node) => (
                <div key={node.id} className="rounded-xl bg-surface-elevated p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{node.label}</p>
                      <p className="mt-0.5 text-[11px] text-text-tertiary">{node.type || "Entity"}{node.group ? ` · ${node.group}` : ""}</p>
                    </div>
                    <span className="rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-tertiary">{node.importance || 3}/5</span>
                  </div>
                  {node.description && <p className="mt-2 text-xs leading-5 text-text-secondary">{node.description}</p>}
                </div>
              ))}
            </div>
            {nodes.length > visibleNodes.length && (
              <p className="mt-3 text-[11px] text-text-tertiary">{formatI18n(t("docReader.graph.moreEntities"), { shown: visibleNodes.length, total: nodes.length })}</p>
            )}
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <p className="text-xs font-semibold text-text-primary">{t("docReader.graph.entityRelations")}</p>
            <div className="mt-3 space-y-2">
              {visibleEdges.map((edge, index) => {
                const source = nodeLabelMap.get(edge.source) || edge.source;
                const target = nodeLabelMap.get(edge.target) || edge.target;
                return (
                  <div key={`${edge.source}-${edge.target}-${index}`} className="rounded-xl bg-surface-elevated p-3">
                    <p className="text-xs font-medium text-text-primary">{source} <span className="text-brand">→ {edge.label || "Relation"} →</span> {target}</p>
                    <p className="mt-1 text-[11px] text-text-tertiary">{t("docReader.graph.confidence")}：{edge.confidence || "medium"}</p>
                    {edge.evidence && <p className="mt-2 text-[11px] leading-4 text-text-secondary">{t("docReader.graph.evidence")}：{edge.evidence}</p>}
                  </div>
                );
              })}
            </div>
            {edges.length > visibleEdges.length && (
              <p className="mt-3 text-[11px] text-text-tertiary">{formatI18n(t("docReader.graph.moreRelations"), { shown: visibleEdges.length, total: edges.length })}</p>
            )}
          </div>

          {summary.length > 0 && (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
              <p className="text-xs font-semibold text-text-primary">{t("docReader.graph.insights")}</p>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-text-secondary">
                {summary.map((item, index) => <li key={index}>• {item}</li>)}
              </ul>
            </div>
          )}
        </div>
      );
    }

    const normalizedInfographic = normalizeInfographicResult(payload, artifact.raw || "");
    const sections: InfographicSection[] = Array.isArray(normalizedInfographic.sections) ? normalizedInfographic.sections : [];
    const highlights = safeTextArray(normalizedInfographic.highlights);
    const visibleHighlights = highlights.slice(0, 12);
    const visibleSections = sections.slice(0, 8);
    const visualSections = sections.slice(0, 8);
    return (
      <div className="space-y-4">
        <InfographicPreview
          title={normalizedInfographic.title || artifact.title || "Infographic"}
          subtitle={normalizedInfographic.subtitle}
          summary={normalizedInfographic.summary}
          highlights={highlights}
          sections={visualSections}
        />

        {(normalizedInfographic.subtitle || normalizedInfographic.summary) && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            {normalizedInfographic.subtitle && <p className="text-sm text-text-secondary">{normalizedInfographic.subtitle}</p>}
            {normalizedInfographic.summary && <p className="mt-2 text-xs leading-5 text-text-tertiary">{normalizedInfographic.summary}</p>}
          </div>
        )}
        {highlights.length > 0 && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <p className="text-xs font-semibold text-text-primary">{t("docReader.infographic.highlights")}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {visibleHighlights.map((item, index) => (
                <div key={index} className="rounded-xl bg-brand/10 px-3 py-2 text-xs leading-5 text-brand">{item}</div>
              ))}
            </div>
            {highlights.length > visibleHighlights.length && (
              <p className="mt-3 text-[11px] text-text-tertiary">{formatI18n(t("docReader.infographic.moreHighlights"), { shown: visibleHighlights.length, total: highlights.length })}</p>
            )}
          </div>
        )}
        {sections.length > 0 && (
          <div className="space-y-3">
            {visibleSections.map((section, index) => (
              <div key={`${section.section_title}-${index}`} className="rounded-2xl border border-surface-border bg-surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{index + 1}. {section.section_title}</p>
                    {section.section_purpose && <p className="mt-1 text-xs text-text-tertiary">{section.section_purpose}</p>}
                  </div>
                  <span className="shrink-0 rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-text-tertiary">{section.visual_type || "Card"}</span>
                </div>
                {section.key_points && section.key_points.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-xs leading-5 text-text-secondary">
                    {section.key_points.map((point, pointIndex) => <li key={pointIndex}>• {point}</li>)}
                  </ul>
                )}
                {section.data_points && section.data_points.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {section.data_points.map((point, pointIndex) => (
                      <span key={pointIndex} className="rounded-full bg-surface-elevated px-2 py-1 text-[11px] text-text-tertiary">{point}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sections.length > visibleSections.length && (
              <p className="rounded-xl bg-surface-card px-3 py-2 text-[11px] text-text-tertiary">{formatI18n(t("docReader.infographic.moreModules"), { shown: visibleSections.length, total: sections.length })}</p>
            )}
          </div>
        )}
        {normalizedInfographic.style_recommendation && Object.values(normalizedInfographic.style_recommendation).some(Boolean) && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <p className="text-xs font-semibold text-text-primary">{t("docReader.infographic.visualAdvice")}</p>
            <div className="mt-3 space-y-2 text-xs leading-5 text-text-secondary">
              {normalizedInfographic.style_recommendation.layout && <p>{t("docReader.infographic.layout")}：{normalizedInfographic.style_recommendation.layout}</p>}
              {normalizedInfographic.style_recommendation.tone && <p>{t("docReader.infographic.tone")}：{normalizedInfographic.style_recommendation.tone}</p>}
              {normalizedInfographic.style_recommendation.color_theme && <p>{t("docReader.infographic.color")}：{normalizedInfographic.style_recommendation.color_theme}</p>}
              {normalizedInfographic.style_recommendation.icon_style && <p>{t("docReader.infographic.icon")}：{normalizedInfographic.style_recommendation.icon_style}</p>}
            </div>
          </div>
        )}
        {normalizedInfographic.ready_to_design_copy && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <p className="text-xs font-semibold text-text-primary">{t("docReader.infographic.designPrompt")}</p>
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-elevated p-3 text-xs leading-5 text-text-secondary">{normalizedInfographic.ready_to_design_copy}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* ===== Center Panel: PDF Viewer ===== */}
      <main
        className={cn(
          "relative flex flex-1 min-w-0 flex-col bg-surface transition-all",
          dragOver && "ring-2 ring-inset ring-brand/30"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {/* PDF Toolbar */}
        <div className="flex h-12 items-center justify-between border-b border-surface-border px-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFilePanel((v) => !v)}
              className={cn(
                "rounded-lg p-1.5 transition",
                showFilePanel ? "bg-surface-card text-brand" : "text-text-tertiary hover:text-text-primary"
              )}
              title={t("docReader.file.docList")}
            >
              <FileText className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowThumbnails((v) => !v)}
              className={cn(
                "rounded-lg p-1.5 transition",
                showThumbnails ? "bg-surface-card text-brand" : "text-text-tertiary hover:text-text-primary"
              )}
              title={t("docReader.file.thumbnails")}
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <div className="mx-2 h-4 w-px bg-surface-border" />
            <button
              onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
              disabled={pdfPage <= 1}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[60px] text-center text-xs text-text-secondary">
              {pdfNumPages > 0 ? `${pdfPage} / ${pdfNumPages}` : "-"}
            </span>
            <button
              onClick={() => setPdfPage((p) => Math.min(pdfNumPages, p + 1))}
              disabled={pdfPage >= pdfNumPages}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            {activeFile && (
              <span className="truncate text-xs text-text-secondary" title={activeFile.name}>
                {activeFile.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPdfScale((s) => Math.max(0.5, s - 0.2))}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[72px] text-center text-xs text-text-secondary">
              {t("docReader.pdf.fitWidth")} {Math.round(pdfScale * 100)}%
            </span>
            <button
              onClick={() => setPdfScale((s) => Math.min(3, s + 0.2))}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <div className="mx-2 h-4 w-px bg-surface-border" />
            <button
              onClick={() => setPdfRotation((r) => (r + 90) % 360)}
              className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Floating File Panel */}
        {showFilePanel && (
          <div className="absolute left-0 top-12 z-50 flex h-[calc(100vh-3rem)] w-[260px] flex-col border-r border-b border-surface-border bg-surface-elevated shadow-xl">
            <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
              <FileText className="h-5 w-5 text-brand" />
              <span className="text-sm font-semibold text-text-primary">{t("docReader.file.docList")}</span>
            </div>

            <div className="p-3">
              <button
                onClick={openUploadDialog}
                disabled={uploading}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-surface-border px-3 py-2.5 text-sm font-medium text-text-secondary transition hover:border-brand/50 hover:bg-surface-card hover:text-brand",
                  uploading && "opacity-60 cursor-not-allowed"
                )}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {uploading ? t("docReader.upload.uploading") : t("docReader.upload.uploadPdf")}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {files.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <FileText className="h-8 w-8 text-text-tertiary/40" />
                  <p className="text-xs text-text-tertiary">{t("docReader.file.noDocs")}</p>
                  <p className="text-[11px] text-text-tertiary/60">{t("docReader.upload.dragDrop")}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {files.map((f) => (
                    <div
                      key={f.id}
                      onClick={() => {
                        setActiveFileId(f.id);
                        setPdfPage(1);
                        setShowFilePanel(false);
                        if (f.publicId && f.parseStatus !== "done") {
                          void refreshFileStatus(f.publicId).then((status) => {
                            if (status.parse_status === "done") toast.success(t("docReader.status.parsed"));
                          }).catch(() => undefined);
                        }
                      }}
                      className={cn(
                        "group relative flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 transition",
                        activeFileId === f.id
                          ? "bg-surface-card ring-1 ring-brand/20"
                          : "hover:bg-surface-card"
                      )}
                    >
                      <div className="mt-0.5 shrink-0">
                        <FileText
                          className={cn(
                            "h-4 w-4",
                            activeFileId === f.id ? "text-brand" : "text-text-tertiary"
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-xs font-medium",
                            activeFileId === f.id ? "text-brand" : "text-text-primary"
                          )}
                        >
                          {f.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-tertiary">
                          {formatFileSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString()}
                        </p>
                        {f.parseStatus === "error" && f.errorMessage && (
                          <p className="mt-0.5 text-[11px] text-red-400">{f.errorMessage}</p>
                        )}
                        {(f.parseStatus === "pending" || f.parseStatus === "parsing") && (
                          <p className="mt-0.5 text-[11px] text-text-tertiary/70">{t("docReader.status.parsing")}</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(f.id);
                        }}
                        className="mt-0.5 shrink-0 rounded-md p-1 text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-red-400 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PDF Content */}
        <div className="relative flex flex-1 min-w-0 overflow-hidden bg-surface-elevated/50">
          {showThumbnails && activeFile && (
            <aside className="flex w-[132px] shrink-0 flex-col overflow-hidden border-r border-surface-border bg-surface-elevated/80">
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <div className="space-y-3">
                  {Array.from({ length: pdfNumPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      onClick={() => scrollToPdfPage(pageNum)}
                      className={cn(
                        "group flex w-full cursor-pointer flex-col items-center rounded-xl px-2 py-2 transition",
                        pdfPage === pageNum ? "bg-surface-card" : "hover:bg-surface-card/70"
                      )}
                    >
                      <div className="relative w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-surface-border/70">
                        {pdfWorkerReady ? (
                          <Document
                            file={activeFile.url}
                            loading={<div className="aspect-[3/4] w-full animate-pulse bg-surface-hover" />}
                            error={<div className="aspect-[3/4] w-full bg-surface-hover" />}
                          >
                            <Page
                              pageNumber={pageNum}
                              width={86}
                              rotate={pdfRotation}
                              renderTextLayer={false}
                              renderAnnotationLayer={false}
                            />
                          </Document>
                        ) : (
                          <div className="aspect-[3/4] w-full animate-pulse bg-surface-hover" />
                        )}
                      </div>
                      <span
                        className={cn(
                          "mt-1.5 flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition",
                          pdfPage === pageNum
                            ? "bg-brand text-white"
                            : "text-text-tertiary group-hover:text-text-secondary"
                        )}
                      >
                        {pageNum}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          )}

          {/* Main PDF view */}
          <div
            ref={pdfViewportRef}
            className="flex flex-1 min-w-0 justify-center overflow-auto px-3 py-4"
            onScroll={handlePdfScroll}
          >
            {activeFile ? (
              pdfWorkerReady ? (
                <div className="w-full min-w-0">
                  <Document
                    file={activeFile.url}
                    onLoadSuccess={({ numPages }) => {
                      setPdfNumPages(numPages);
                      setFiles((prev) =>
                        prev.map((f) => (f.id === activeFile.id ? { ...f, pageCount: numPages } : f))
                      );
                    }}
                    onLoadError={(error) => {
                      console.error("[PDF] load error:", error);
                      toast.error(docFileError(error, t("docReader.error.pdfLoad")));
                    }}
                    onSourceError={(error) => {
                      console.error("[PDF] source error:", error);
                      toast.error(docFileError(error, t("docReader.error.pdfSource")));
                    }}
                    error={
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <FileText className="h-10 w-10 text-text-tertiary/40" />
                        <p className="text-sm text-text-secondary">{t("docReader.pdf.loadFailed")}</p>
                        <p className="text-xs text-text-tertiary">{t("docReader.pdf.retryUpload")}</p>
                      </div>
                    }
                    loading={
                      <div className="flex h-[60vh] w-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
                      </div>
                    }
                  >
                    <div className="flex flex-col items-center gap-5 pb-6">
                      {Array.from({ length: pdfNumPages }, (_, i) => i + 1).map((pageNum) => (
                        <div
                          key={`page-${pageNum}-${pdfRotation}`}
                          ref={(node) => {
                            pdfPageRefs.current[pageNum] = node;
                          }}
                          className="scroll-mt-6 rounded-md bg-white shadow-lg"
                        >
                          <Page
                            pageNumber={pageNum}
                            width={pdfPageWidth}
                            rotate={pdfRotation}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            loading={
                              <div className="flex h-[60vh] w-full items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
                              </div>
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </Document>
                </div>
              ) : (
                <div className="flex h-[60vh] w-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-card">
                  <FileText className="h-8 w-8 text-text-tertiary/40" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-text-secondary">{t("docReader.placeholder.selectDoc")}</p>
                  <p className="text-xs text-text-tertiary">{t("docReader.empty.pdfSupport")}</p>
                </div>
                <button
                  onClick={openUploadDialog}
                  disabled={uploading}
                  className="mt-2 flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {uploading ? t("docReader.upload.uploading") : t("docReader.upload.document")}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Drag Handle */}
      <div
        onMouseDown={startResize}
        className="group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-surface-border transition hover:bg-brand/40"
        title={t("docReader.resize")}
      >
        <div className="absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-tertiary/20 group-hover:bg-brand/60" />
      </div>

      {/* ===== Right Panel ===== */}
      <aside style={{ width: rightWidth }} className="flex shrink-0 flex-col border-l border-surface-border bg-surface-elevated">
        {/* Tab Header */}
        <div className="flex h-12 items-center border-b border-surface-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setRightTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-xs font-medium transition",
                rightTab === t.key
                  ? "border-brand text-brand"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {rightTab === "study" && (
            <>
              {/* Messages */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-6">
                    {/* Welcome */}
                    <div className="text-center">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-card">
                        <BookOpen className="h-6 w-6 text-brand" />
                      </div>
                      <h3 className="text-sm font-semibold text-text-primary">{t("docReader.title")}</h3>
                      <p className="mt-1 text-xs text-text-tertiary">{t("docReader.subtitle")}</p>
                    </div>

                    {/* Examples */}
                    <div className="grid grid-cols-2 gap-2">
                      {welcomeExamples.map((ex) => (
                        <button
                          key={ex.title}
                          onClick={() => {
                            if (activeFile) {
                              sendChat(ex.prompt + (activeFile ? `(${t("docReader.prompt.docPrefix")}${activeFile.name})` : ""), activeFile ? [activeFile.publicId] : undefined);
                            } else {
                              toast.info(t("docReader.warn.uploadFirst"));
                            }
                          }}
                          className="flex flex-col gap-1 rounded-xl border border-surface-border bg-surface-card p-3 text-left transition hover:border-brand/30 hover:shadow-sm"
                        >
                          <span className="text-xs font-medium text-text-primary">{ex.title}</span>
                          <span className="text-[11px] text-text-tertiary">{ex.desc}</span>
                        </button>
                      ))}
                    </div>

                    {/* Quick actions when file active */}
                    {activeFile && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{t("docReader.label.quickActions")}</p>
                        <div className="flex flex-wrap gap-2">
                          {quickActions.map((action) => {
                            const prompt = action.prompt(activeFile.name, activeFile.publicId);
                            const fileIds = action.fileIds(activeFile.publicId);
                            return (
                              <button
                                key={action.label}
                                onClick={() => sendChat(prompt, fileIds)}
                                disabled={isLoading}
                                className="flex items-center gap-1.5 rounded-lg bg-surface-card px-3 py-1.5 text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                              >
                                <action.icon className="h-3.5 w-3.5" />
                                {action.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-2",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {msg.role === "assistant" && (
                          <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10">
                            <Sparkles className="h-3 w-3 text-brand" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                            msg.role === "user"
                              ? "bg-brand text-white"
                              : "bg-surface-card text-text-primary"
                          )}
                        >
                          {msg.isStreaming && !msg.content ? (
                            <div className="flex items-center gap-1.5 py-1">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
                              <span className="text-xs text-text-tertiary">{t("docReader.status.thinking")}</span>
                            </div>
                          ) : msg.role === "assistant" && !msg.isStreaming ? (
                            <div className="prose prose-sm max-w-none">
                              <MarkdownRenderer content={typeof msg.content === "string" ? msg.content : String(msg.content)} />
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap">{typeof msg.content === "string" ? msg.content : String(msg.content)}</div>
                          )}
                          {msg.isStreaming && msg.content && (
                            <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-brand/60" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-surface-border p-3">
                {/* Toolbar */}
                <div className="mb-2 flex items-center justify-end gap-1">
                  <button
                    onClick={() => {
                      setShowHistory(true);
                      void loadHistoryList(true);
                    }}
                    className={cn(
                      "flex items-center justify-center rounded-lg p-1.5 text-xs transition",
                      showHistory
                        ? "bg-brand/10 text-brand"
                        : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                    )}
                    title={t("docReader.label.history")}
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    onClick={startNewChat}
                    className="flex items-center justify-center rounded-lg p-1.5 text-xs text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
                    title={t("docReader.label.newConversation")}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {messages.length > 0 && (
                    <button
                      onClick={clearChat}
                      className="flex items-center justify-center rounded-lg p-1.5 text-xs text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
                      title={t("docReader.label.clearChat")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="rounded-3xl border border-surface-border bg-surface-card p-3 transition focus-within:border-brand/40 focus-within:ring-1 focus-within:ring-brand/20">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (activeFile) {
                          sendChat(inputText, [activeFile.publicId]);
                        } else {
                          sendChat(inputText);
                        }
                      }
                    }}
                    placeholder={activeFile ? t("docReader.placeholder.askDocument") : t("docReader.placeholder.uploadFirst")}
                    rows={1}
                    disabled={isLoading}
                    className="max-h-[120px] min-h-[40px] w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
                    style={{ height: "auto" }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = "auto";
                      target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                    }}
                  />
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      onClick={() => {
                        if (activeFile) {
                          sendChat(inputText, [activeFile.publicId]);
                        } else {
                          sendChat(inputText);
                        }
                      }}
                      disabled={!inputText.trim() || isLoading}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-400 text-white transition hover:bg-blue-500 disabled:opacity-30"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1 px-1">
                  <FileText className="h-3 w-3 text-text-tertiary" />
                  <span className="truncate text-[11px] text-text-tertiary">
                    {activeFile ? `${t("docReader.label.linkedDocument")}: ${activeFile.name}` : t("docReader.label.noDocument")}
                  </span>
                </div>
              </div>
            </>
          )}

          {rightTab === "graph" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{"Knowledge Graph"}</p>
                  <p className="truncate text-[11px] text-text-tertiary">{activeFile ? activeFile.name : t("docReader.label.selectPdfToGenerate")}</p>
                </div>
                <button
                  onClick={generateKnowledgeGraph}
                  disabled={graphLoading || !activeFile}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {graphLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
                  {graphArtifacts.length > 0 ? t("docReader.button.regenerate") : t("docReader.button.generate")}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {graphArtifacts.length === 0 ? (
                  <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10">
                      <Network className="h-6 w-6 text-brand" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-text-primary">{t("docReader.title.pdfToGraph")}</h3>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      {t("docReader.desc.pdfToGraph")}
                    </p>
                    <div className="mt-4 space-y-2 rounded-xl bg-surface-elevated p-3 text-xs text-text-tertiary">
                      <p>• {t("docReader.label.entityCategories")}: {t("docReader.label.entityCategoriesValue")}</p>
                      <p>• {t("docReader.label.relationTable")}: {t("docReader.label.relationTableValue")}</p>
                      <p>• {t("docReader.label.evidence2")}: {t("docReader.label.evidence2Value")}</p>
                    </div>
                  </div>
                ) : renderArtifactCards(graphArtifacts, Network)}
              </div>
            </div>
          )}

          {rightTab === "infographic" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{"Infographic"}</p>
                  <p className="truncate text-[11px] text-text-tertiary">{activeFile ? activeFile.name : t("docReader.label.selectPdfToGenerate")}</p>
                </div>
                <button
                  onClick={generateInfographic}
                  disabled={infographicLoading || !activeFile}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {infographicLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {infographicArtifacts.length > 0 ? t("docReader.button.regenerate") : t("docReader.button.generate")}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {infographicArtifacts.length === 0 ? (
                  <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10">
                      <ImageIcon className="h-6 w-6 text-brand" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-text-primary">{t("docReader.title.pdfToInfographic")}</h3>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      {t("docReader.desc.pdfToInfographic")}
                    </p>
                    <div className="mt-4 space-y-2 rounded-xl bg-surface-elevated p-3 text-xs text-text-tertiary">
                      <p>• {t("docReader.desc.modules")}</p>
                      <p>• {t("docReader.desc.highlightData")}</p>
                      <p>• {t("docReader.desc.styleSuggestions")}</p>
                    </div>
                  </div>
                ) : renderArtifactCards(infographicArtifacts, ImageIcon)}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* 右侧历史记录面板 */}


      {artifactModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm" onClick={() => setArtifactModal(null)}>
          <div
            className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-surface-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {artifactModal.kind === "knowledge_graph" ? <Network className="h-4 w-4 text-brand" /> : <ImageIcon className="h-4 w-4 text-brand" />}
                  <p className="truncate text-sm font-semibold text-text-primary">{artifactModal.title || (artifactModal.kind === "knowledge_graph" ? "Knowledge Graph" : "Infographic")}</p>
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">{t("docReader.label.generatedAt")} {formatDate(artifactModal.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => document.getElementById("artifact-visualization-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1.5 text-xs font-medium text-brand transition hover:bg-brand/15"
                >
                  {artifactModal.kind === "knowledge_graph" ? <Network className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {t("docReader.visual.button")}
                </button>
                <button
                  onClick={() => handleDeleteArtifact(artifactModal)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-tertiary transition hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common.delete")}
                </button>
                <button
                  onClick={() => setArtifactModal(null)}
                  className="rounded-lg p-1.5 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-5 py-5">
              {renderArtifactModalContent(artifactModal)}
            </div>
          </div>
        </div>
      )}
      <HistoryDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title={t("docReader.label.studyHistory")}
        loading={historyLoading}
        emptyText={t("docReader.empty.noStudyHistory")}
        items={history.map((item): DrawerHistoryItem => ({
          id: item.id,
          title: item.title,
          subtitle: `${item.model || DEFAULT_MODEL} · ${formatDate(item.updated_at)}`,
          updated_at: item.updated_at,
          active: activeHistoryId === item.id || conversationId === item.id,
          icon: "file",
        }))}
        onSelect={(id) => {
          void loadHistoryConversation(id);
          setShowHistory(false);
        }}
        deleteConfirmTitle={t("common.deleteSession")}
        deleteConfirmDescription={(item) => `${t("common.deleteSessionDesc")}\n${item.title}`}
        onDelete={(id) => void deleteHistoryItem(id)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteTarget?.kind === "knowledge_graph" ? "Knowledge Graph" : "Infographic"}
        description={t("docReader.deleteConfirm.description")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
