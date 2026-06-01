"use client";

import { Bot } from "lucide-react";

export type ChatWelcomeExample = {
  title: string;
  desc: string;
  prompt: string;
};

export type ChatEmptyStateProps = {
  userName: string;
  greeting: string;
  userGreetingTemplate: string;
  whatCanWeDoLabel: string;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: ChatWelcomeExample[];
  bottomSpacer: number;
};

export default function ChatEmptyState({
  userName,
  greeting,
  userGreetingTemplate,
  whatCanWeDoLabel,
  welcomeTitle,
  welcomeSubtitle,
  welcomeExamples,
  bottomSpacer,
}: ChatEmptyStateProps) {
  const hasCustomWelcome = !!welcomeExamples?.length;

  return (
    <div className="flex flex-1 flex-col items-center justify-start px-4 pt-48" style={{ paddingBottom: bottomSpacer }}>
      <div className="max-w-md text-center">
        {hasCustomWelcome ? (
          <>
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-surface-border bg-surface-card">
              <Bot className="h-5 w-5 text-text-secondary" />
            </div>
            <h2 className="mb-2 text-xl font-semibold tracking-tight text-text-primary">{welcomeTitle}</h2>
            {welcomeSubtitle && (
              <p className="mb-8 text-sm leading-relaxed text-text-secondary">{welcomeSubtitle}</p>
            )}
          </>
        ) : (
          <>
            <h1 className="mb-2 text-[32px] font-semibold leading-tight tracking-tight text-text-primary">
              {userName ? userGreetingTemplate.replace("{name}", userName) : greeting}
            </h1>
            <p className="text-[25px] font-medium leading-tight tracking-tight text-text-primary/80">{whatCanWeDoLabel}</p>
          </>
        )}
      </div>
    </div>
  );
}
