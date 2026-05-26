"use client";

import { useEffect, useState } from "react";
import { Bot, User, Sparkles, ImageIcon, Presentation, Search, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface Message {
  role: "user" | "ai";
  textKey: string;
  delay: number;
  icon?: "chat" | "image" | "ppt" | "search" | "brain";
}

const demoMessages: Message[] = [
  { role: "user", textKey: "landing.demo.user1", delay: 500 },
  { role: "ai", textKey: "landing.demo.ai1", delay: 1200, icon: "brain" },
  { role: "ai", textKey: "landing.demo.ai2", delay: 2000, icon: "chat" },
  { role: "user", textKey: "landing.demo.user2", delay: 3200 },
  { role: "ai", textKey: "landing.demo.ai3", delay: 4000, icon: "image" },
  { role: "user", textKey: "landing.demo.user3", delay: 5500 },
  { role: "ai", textKey: "landing.demo.ai4", delay: 6200, icon: "ppt" },
];

function ModelBadge({ icon }: { icon: Message["icon"] }) {
  const { t } = useI18n();
  const configs = {
    chat: { icon: Sparkles, color: "text-brand", bg: "bg-brand/10", label: "GPT 5.4" },
    image: { icon: ImageIcon, color: "text-purple-500", bg: "bg-purple-500/10", label: "GPT Image 2" },
    ppt: { icon: Presentation, color: "text-orange-500", bg: "bg-orange-500/10", label: "AI PPT" },
    search: { icon: Search, color: "text-green-500", bg: "bg-green-500/10", label: t("landing.demo.search") },
    brain: { icon: Brain, color: "text-amber-500", bg: "bg-amber-500/10", label: "GPT 5.5" },
  };
  const cfg = icon && configs[icon] ? configs[icon] : configs.chat;
  const Icon = cfg.icon;
  return <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium", cfg.bg, cfg.color)}><Icon className="w-3 h-3" />{cfg.label}</span>;
}

export default function ChatDemo() {
  const { t, language } = useI18n();
  const [visibleCount, setVisibleCount] = useState(0);
  const [typingIndex, setTypingIndex] = useState<number | null>(null);
  const [typingText, setTypingText] = useState("");

  useEffect(() => {
    setVisibleCount(0);
    setTypingIndex(null);
    setTypingText("");
    let timeouts: NodeJS.Timeout[] = [];
    demoMessages.forEach((msg, i) => {
      const text = t(msg.textKey);
      const timeout = setTimeout(() => {
        setVisibleCount(i + 1);
        if (msg.role === "ai") {
          setTypingIndex(i);
          setTypingText("");
          let charIdx = 0;
          const interval = setInterval(() => {
            charIdx++;
            setTypingText(text.slice(0, charIdx));
            if (charIdx >= text.length) {
              clearInterval(interval);
              setTypingIndex(null);
            }
          }, 25);
          timeouts.push(interval as unknown as NodeJS.Timeout);
        }
      }, msg.delay);
      timeouts.push(timeout);
    });
    return () => timeouts.forEach(clearTimeout);
  }, [t, language]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="absolute -inset-4 bg-gradient-to-r from-brand/5 via-purple-500/5 to-brand/5 rounded-3xl blur-2xl animate-pulse-glow" />
      <div className="relative bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border bg-surface-elevated/50">
          <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400/80" /><div className="w-3 h-3 rounded-full bg-amber-400/80" /><div className="w-3 h-3 rounded-full bg-green-400/80" /></div>
          <span className="text-xs text-text-tertiary ml-2">{t("landing.demo.windowTitle")}</span>
        </div>
        <div className="px-4 py-4 space-y-3 min-h-[320px] max-h-[360px] overflow-hidden">
          {demoMessages.slice(0, visibleCount).map((msg, i) => (
            <div key={i} className={cn("flex gap-2.5 animate-message-appear", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", msg.role === "user" ? "bg-brand/10" : "bg-surface-elevated border border-surface-border")}>
                {msg.role === "user" ? <User className="w-3.5 h-3.5 text-brand" /> : <Bot className="w-3.5 h-3.5 text-text-secondary" />}
              </div>
              <div className={cn("max-w-[80%] px-3 py-2 rounded-xl text-[13px] leading-relaxed", msg.role === "user" ? "bg-brand/10 text-text-primary rounded-br-sm" : "bg-surface-elevated text-text-secondary rounded-bl-sm border border-surface-border")}>
                {msg.role === "ai" && msg.icon && <div className="mb-1.5"><ModelBadge icon={msg.icon} /></div>}
                <span>{typingIndex === i ? typingText : t(msg.textKey)}{typingIndex === i && <span className="inline-block w-0.5 h-3.5 bg-brand ml-0.5 animate-cursor-blink align-middle" />}</span>
              </div>
            </div>
          ))}
          {visibleCount < demoMessages.length && visibleCount > 0 && <div className="flex items-center gap-1.5 px-12"><div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: "0ms" }} /><div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: "150ms" }} /><div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: "300ms" }} /></div>}
        </div>
        <div className="px-4 py-3 border-t border-surface-border">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated border border-surface-border">
            <div className="flex-1 text-[13px] text-text-tertiary">{t("landing.demo.input")}</div>
            <div className="w-6 h-6 rounded-lg bg-brand flex items-center justify-center"><Sparkles className="w-3 h-3 text-white" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
