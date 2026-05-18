import { useState, useCallback, useRef } from "react";
import { getGuestId } from "@/lib/guestId";

const API_BASE = "/api";

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  preview: string;
  primaryColor: string;
}

export interface OutlineSlide {
  page: number;
  type: string;
  title: string;
  one_liner: string;
  need_image: boolean;
}

export interface Outline {
  title: string;
  subtitle?: string;
  audience?: string;
  purpose?: string;
  slides: OutlineSlide[];
  image_plan?: string;
}

export interface SlideImage {
  needed: boolean;
  type?: string;
  prompt?: string;
  placement?: string;
  url?: string;
}

export interface SlideChart {
  type?: string;
  title?: string;
  labels?: string[];
  values?: string[][];
}

export interface FullSlide {
  page: number;
  type: string;
  title: string;
  subtitle?: string;
  content: string[];
  layout: string;
  image?: SlideImage;
  chart?: SlideChart;
  speaker_notes?: string;
  source_refs?: string[];
}

export interface PPTTask {
  id: number;
  title: string;
  topic: string;
  template_id: string;
  slide_count: number;
  status: string;
  progress: number;
  progress_msg: string;
  created_at: string;
}

export interface PPTConfig {
  topic: string;
  templateId: string;
  slideCount: number;
  language: string;
  audience: string;
  purpose: string;
  withImages: string;
  withNotes: boolean;
  qualityMode: string;
}

export interface PPTImageJob {
  id: number;
  ppt_id: number;
  page: number;
  prompt: string;
  status: string;
  image_url: string;
  error_msg: string;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export function usePPT() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [task, setTask] = useState<PPTTask | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [slides, setSlides] = useState<FullSlide[]>([]);
  const [imageJobs, setImageJobs] = useState<PPTImageJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const getToken = () =>
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) h["Authorization"] = `Bearer ${token}`;
    const guestId = getGuestId();
    if (guestId) h["X-Guest-ID"] = guestId;
    return h;
  };

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ppt/templates`, { headers: headers() });
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(async (config: PPTConfig) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ppt`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          topic: config.topic,
          template_id: config.templateId,
          slide_count: config.slideCount,
          language: config.language,
          audience: config.audience,
          purpose: config.purpose,
          with_images: config.withImages,
          with_notes: config.withNotes,
          quality_mode: config.qualityMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setTask({
        id: data.id,
        title: config.topic,
        topic: config.topic,
        template_id: config.templateId,
        slide_count: config.slideCount,
        status: data.status,
        progress: 0,
        progress_msg: "准备生成...",
        created_at: new Date().toISOString(),
      });
      return data.id as number;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateOutline = useCallback(async (pptId: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/outline`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成大纲失败");
      setOutline(data.outline || null);
      setTask((prev) =>
        prev ? { ...prev, status: data.status, progress: 30, progress_msg: "大纲已生成" } : prev
      );
      return data.outline as Outline;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const confirmOutline = useCallback(async (pptId: number, customOutline?: Outline) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/confirm`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ outline: customOutline || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setSlides(data.slides || []);
      setTask((prev) =>
        prev
          ? {
              ...prev,
              status: data.status,
              progress: data.ppt?.progress ?? prev.progress,
              progress_msg: data.ppt?.progress_msg ?? prev.progress_msg,
              title: data.ppt?.title || prev.title,
            }
          : prev
      );
      return data as { status: string; slides: FullSlide[]; ppt: PPTTask };
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getStatus = useCallback(async (pptId: number) => {
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/status`, { headers: headers() });
      const data = await res.json();
      if (res.ok) {
        setTask((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                progress: data.progress,
                progress_msg: data.progress_msg,
                title: data.title || prev.title,
              }
            : prev
        );
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  const TERMINAL_STATUSES = ["completed", "failed", "outline_ready", "partial_completed", "image_failed"];

  const startPolling = useCallback(
    (pptId: number, onComplete?: () => void) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const data = await getStatus(pptId);
        if (data?.status && TERMINAL_STATUSES.includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          onComplete?.();
        }
      }, 2000);
    },
    [getStatus]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const getPPT = useCallback(async (pptId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}`, { headers: headers() });
      const data = await res.json();
      if (res.ok) {
        setSlides(data.slides || []);
        setTask((prev) =>
          prev
            ? { ...prev, title: data.ppt?.title || prev.title, status: data.ppt?.status || prev.status }
            : prev
        );
        if (data.ppt?.outline_json) {
          try {
            const o = JSON.parse(data.ppt.outline_json);
            setOutline(o);
          } catch {}
        }
      }
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSlide = useCallback(async (pptId: number, page: number, slide: FullSlide) => {
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/slides/${page}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(slide),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const rewriteSlide = useCallback(async (pptId: number, page: number, instruction: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/slides/${page}/rewrite`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (res.ok && data.slide) {
        setSlides((prev) => prev.map((s) => (s.page === page ? data.slide : s)));
        return data.slide as FullSlide;
      }
      return null;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const regenerateImage = useCallback(async (pptId: number, page: number, instruction?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/slides/${page}/image`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ instruction: instruction || "" }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setSlides((prev) =>
          prev.map((s) =>
            s.page === page ? { ...s, image: { ...s.image, url: data.url } as SlideImage } : s
          )
        );
      }
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const exportPPT = useCallback((pptId: number, format: string) => {
    const h = headers();
    const qs = new URLSearchParams();
    Object.entries(h).forEach(([k, v]) => {
      if (k !== "Content-Type") qs.append(k, v);
    });
    window.open(`${API_BASE}/ppt/${pptId}/export/${format}?${qs.toString()}`, "_blank");
  }, []);

  const listPPTs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ppt`, { headers: headers() });
      const data = await res.json();
      return (data.ppts || []) as PPTTask[];
    } catch {
      return [];
    }
  }, []);

  const deletePPT = useCallback(async (pptId: number) => {
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}`, {
        method: "DELETE",
        headers: headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const getImageJobs = useCallback(async (pptId: number) => {
    try {
      const res = await fetch(`${API_BASE}/ppt/${pptId}/image-jobs`, { headers: headers() });
      const data = await res.json();
      if (res.ok) {
        setImageJobs(data.image_jobs || []);
      }
      return data.image_jobs as PPTImageJob[];
    } catch {
      return [];
    }
  }, []);

  return {
    templates,
    task,
    outline,
    slides,
    imageJobs,
    loading,
    error,
    fetchTemplates,
    createTask,
    generateOutline,
    confirmOutline,
    getStatus,
    startPolling,
    stopPolling,
    getPPT,
    updateSlide,
    rewriteSlide,
    regenerateImage,
    exportPPT,
    listPPTs,
    deletePPT,
    getImageJobs,
    setError,
    setOutline,
  };
}
