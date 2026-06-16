"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, AlertTriangle, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface BadCaseData {
  model_id: string;
  model_name: string;
  bad_case_description: string;
  expected_answer: string;
  conversation_id?: number;
  message_id?: number;
}

interface CreditExhaustedModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: BadCaseData) => Promise<void>;
  currentModel?: { id: string; name: string };
  conversationId?: number;
  tierName?: string;
  betaPhaseInfo?: {
    phase: string;
    phase_name: string;
    next_phase?: {
      phase: string;
      phase_name: string;
      unlock_condition: string;
      credits: number;
    };
  } | null;
}

export default function CreditExhaustedModal({
  open,
  onClose,
  onSubmit,
  currentModel,
  conversationId,
  tierName,
  betaPhaseInfo,
}: CreditExhaustedModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<"exhausted" | "submitting" | "submitted">("exhausted");
  const [description, setDescription] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setStep("exhausted");
      setDescription("");
      setExpectedAnswer("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!description.trim() || !expectedAnswer.trim()) {
      setError("请填写模型的逻辑错误点和您的人类专家级正确推演");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        model_id: currentModel?.id || "",
        model_name: currentModel?.name || "",
        bad_case_description: description.trim(),
        expected_answer: expectedAnswer.trim(),
        conversation_id: conversationId,
      });
      setStep("submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-text-primary">
              {step === "exhausted" ? "初始测试算力已耗尽" : step === "submitting" ? "提交 Bad Case" : "提交成功"}
            </h2>
          </div>
          {step !== "submitting" && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {step === "exhausted" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-400/10 border border-amber-400/20 p-4">
                <p className="text-sm text-amber-300 leading-relaxed">
                  您的 <span className="font-semibold">{tierName}</span> 积分额度已耗尽。
                  若需解锁下一阶段的测试额度，请提供过去使用中模型最致命的
                  <span className="font-semibold"> 3 次逻辑错误（Bad Cases）</span>。
                </p>
              </div>

              <div className="space-y-3 text-sm text-text-secondary">
                <p className="font-medium text-text-primary">请指明：</p>
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>模型的错误点（具体哪一步推理断裂）</li>
                  <li>您认为的"人类专家级正确推演"</li>
                  <li>敷衍填写将失去测试资格</li>
                </ul>
              </div>

              <button
                onClick={() => setStep("submitting")}
                className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-hover transition-colors"
              >
                开始提交 Bad Case
              </button>
            </div>
          )}

          {step === "submitting" && (
            <div className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  模型错误描述 <span className="text-red-400">*</span>
                </label>
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述模型在哪一步出现了逻辑错误，上下文是什么..."
                  className="w-full rounded-xl border border-surface-border bg-surface bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[100px] resize-y"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  人类专家级正确推演 <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={expectedAnswer}
                  onChange={(e) => setExpectedAnswer(e.target.value)}
                  placeholder="给出您认为正确的推理过程和结论..."
                  className="w-full rounded-xl border border-surface-border bg-surface bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[100px] resize-y"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep("exhausted")}
                  className="flex-1 rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  返回
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !description.trim() || !expectedAnswer.trim()}
                  className={cn(
                    "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2",
                    submitting || !description.trim() || !expectedAnswer.trim()
                      ? "bg-brand/40 cursor-not-allowed"
                      : "bg-brand hover:bg-brand-hover"
                  )}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      提交中...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      提交
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "submitted" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-text-primary">提交成功</h3>
              <p className="text-sm text-text-secondary">
                后端团队将在 <span className="font-semibold text-text-primary">24-48 小时</span> 内审核您的 Bad Case。
                <br />
                审核通过后，您将获得下一阶段的测试额度。
              </p>
              <button
                onClick={onClose}
                className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover transition-colors"
              >
                知道了
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
