"use client";

import { useState } from "react";
import {
  Layers,
  HelpCircle,
  GitBranch,
  BarChart3,
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Brain,
  BookOpen,
} from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";

type Tab = "flashcard" | "quiz" | "graph" | "infographic";

interface FlashCard {
  front: string;
  back: string;
}

interface QuizItem {
  question: string;
  options: string[];
  answer: number;
}

export default function StudyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("flashcard");
  const [generating, setGenerating] = useState(false);
  const theme = THEMES.green;

  const [flashcards, setFlashcards] = useState<FlashCard[]>([
    { front: "React 是什么？", back: "React 是 Meta 开发的用于构建用户界面的 JavaScript 库，基于组件化和单向数据流。" },
    { front: "useState 的作用？", back: "useState 是 React Hook，用于在函数组件中添加状态管理，返回当前值和更新函数。" },
    { front: "Virtual DOM 是什么？", back: "Virtual DOM 是内存中的 DOM 拟象表示，React 通过 Diff 算法最小化真实 DOM 操作。" },
  ]);
  const [quiz, setQuiz] = useState<QuizItem[]>([
    {
      question: "React 中用于处理副作用的 Hook 是？",
      options: ["useState", "useEffect", "useContext", "useReducer"],
      answer: 1,
    },
    {
      question: "JSX 是什么的简称？",
      options: ["JavaScript XML", "Java Syntax Extension", "JSON XML", "JavaScript eXtension"],
      answer: 0,
    },
  ]);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcFlip, setFcFlip] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [quizShowAnswer, setQuizShowAnswer] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    await new Promise((r) => setTimeout(r, 1500));
    setGenerating(false);
  };

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "flashcard", label: "闪卡", icon: Layers },
    { key: "quiz", label: "测验", icon: HelpCircle },
    { key: "graph", label: "知识图谱", icon: GitBranch },
    { key: "infographic", label: "信息图", icon: BarChart3 },
  ];

  return (
    <DialogShell open={open} onClose={onClose} title="学习游戏屋" icon={<Brain className={`h-4 w-4 ${theme.primary}`} />} size="lg" theme={theme}>
      {/* 顶部学习进度氛围 */}
      <div className={`mb-4 flex items-center gap-3 rounded-xl ${theme.primaryBg} ${theme.primaryBorder} border px-4 py-2.5`}>
        <BookOpen className={`h-4 w-4 ${theme.primary}`} />
        <div className="flex-1">
          <p className="text-xs font-medium text-text-primary">知识空间</p>
          <p className="text-[10px] text-text-tertiary">{flashcards.length} 张闪卡 · {quiz.length} 道测验</p>
        </div>
      </div>

      {/* Tab - 绿色主题 */}
      <div className="mb-4 flex gap-1 rounded-xl bg-surface-card p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFcFlip(false); setQuizSelected(null); setQuizShowAnswer(false); }}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-all ${
              tab === t.key ? `${theme.primaryBg} ${theme.primary} shadow-sm ring-1 ${theme.primaryBorder}` : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 生成按钮 - 绿色强调 */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className={`mb-4 flex w-full items-center justify-center gap-2 rounded-xl border ${theme.primaryBorder} ${theme.primaryBg} py-2.5 text-sm font-medium ${theme.primary} transition-colors hover:brightness-110 disabled:opacity-60`}
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generating ? "AI 生成中..." : "基于当前文件生成学习内容"}
      </button>

      {/* 闪卡 */}
      {tab === "flashcard" && (
        <div className="flex flex-col items-center gap-4">
          {flashcards.length > 0 ? (
            <>
              <div className="relative h-48 w-full cursor-pointer" onClick={() => setFcFlip(!fcFlip)}>
                <div
                  className={`absolute inset-0 flex items-center justify-center rounded-2xl border ${fcFlip ? `${theme.primaryBorder} ${theme.primaryBg}` : "border-surface-border bg-surface-card"} p-6 text-center transition-all duration-500 ${fcFlip ? "scale-x-[-1]" : ""}`}
                >
                  <p className={`text-sm font-medium text-text-primary ${fcFlip ? "scale-x-[-1]" : ""}`}>
                    {fcFlip ? flashcards[fcIndex].back : flashcards[fcIndex].front}
                  </p>
                </div>
                <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-text-tertiary">
                  点击翻转 · {fcIndex + 1} / {flashcards.length}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setFcIndex((i) => Math.max(0, i - 1)); setFcFlip(false); }} disabled={fcIndex === 0} className="rounded-lg border border-surface-border bg-surface-card p-2 text-text-secondary disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => { setFcIndex((i) => Math.min(flashcards.length - 1, i + 1)); setFcFlip(false); }} disabled={fcIndex === flashcards.length - 1} className="rounded-lg border border-surface-border bg-surface-card p-2 text-text-secondary disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <EmptyState icon={Layers} title="暂无闪卡" desc="上传文件后，AI 可自动生成记忆闪卡" theme={theme} />
          )}
        </div>
      )}

      {/* 测验 */}
      {tab === "quiz" && (
        <div className="flex flex-col items-center gap-4">
          {quiz.length > 0 ? (
            <>
              <div className="w-full rounded-2xl border border-surface-border bg-surface-card p-5">
                <p className="mb-4 text-sm font-medium text-text-primary">
                  {quizIndex + 1}. {quiz[quizIndex].question}
                </p>
                <div className="space-y-2">
                  {quiz[quizIndex].options.map((opt, i) => {
                    const isSelected = quizSelected === i;
                    const isCorrect = i === quiz[quizIndex].answer;
                    const show = quizShowAnswer;
                    return (
                      <button
                        key={i}
                        onClick={() => { if (!show) { setQuizSelected(i); setQuizShowAnswer(true); } }}
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${
                          show && isCorrect
                            ? "border-green-500/30 bg-green-500/10 text-green-600"
                            : show && isSelected && !isCorrect
                            ? "border-red-500/30 bg-red-500/10 text-red-500"
                            : isSelected
                            ? `${theme.primaryBorder} ${theme.primaryBg} ${theme.primary}`
                            : "border-surface-border bg-surface-elevated text-text-secondary hover:border-green-500/20"
                        }`}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface text-[10px] font-semibold">
                          {String.fromCharCode(65 + i)}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setQuizIndex((i) => Math.max(0, i - 1)); setQuizSelected(null); setQuizShowAnswer(false); }} disabled={quizIndex === 0} className="rounded-lg border border-surface-border bg-surface-card p-2 text-text-secondary disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex items-center text-xs text-text-tertiary">{quizIndex + 1} / {quiz.length}</span>
                <button onClick={() => { setQuizIndex((i) => Math.min(quiz.length - 1, i + 1)); setQuizSelected(null); setQuizShowAnswer(false); }} disabled={quizIndex === quiz.length - 1} className="rounded-lg border border-surface-border bg-surface-card p-2 text-text-secondary disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <EmptyState icon={HelpCircle} title="暂无测验" desc="AI 可从文件中提取重点生成选择题" theme={theme} />
          )}
        </div>
      )}

      {/* 知识图谱 */}
      {tab === "graph" && (
        <EmptyState icon={GitBranch} title="暂无知识图谱" desc="AI 可分析文件内容，构建概念关联网络图谱" theme={theme} />
      )}

      {/* 信息图 */}
      {tab === "infographic" && (
        <EmptyState icon={BarChart3} title="暂无信息图" desc="将文件数据与概念一键转译为可视化信息图" theme={theme} />
      )}
    </DialogShell>
  );
}

function EmptyState({ icon: Icon, title, desc, theme }: { icon: any; title: string; desc: string; theme: any }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${theme.primaryBorder} ${theme.primaryBg}`}>
        <Icon className={`h-6 w-6 ${theme.primary}`} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-secondary">{title}</p>
        <p className="text-[11px] leading-4 text-text-tertiary">{desc}</p>
      </div>
    </div>
  );
}
