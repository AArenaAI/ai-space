"use client";

import { FileText } from "lucide-react";
import type { Message } from "@/lib/chatTypes";

type UserMessageContentProps = {
  message: Message;
  imageLoadFailedLabel: string;
};

function UserMessageContent({ message, imageLoadFailedLabel }: UserMessageContentProps) {
  const imageFiles = message.files?.filter((file) => file.type === "image") || [];
  const otherFiles = message.files?.filter((file) => file.type !== "image") || [];

  return (
    <div className="flex flex-col gap-2">
      {imageFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageFiles.map((file, index) => (
            <div key={`${file.public_id}-${index}`} className="relative group/file rounded-xl overflow-hidden border border-surface-border bg-surface-card">
              <img
                src={`/api/files/${file.public_id}/download`}
                alt={file.filename}
                className="max-w-[200px] max-h-[200px] object-cover rounded-xl"
                onError={(event) => {
                  (event.target as HTMLImageElement).src = "";
                  (event.target as HTMLImageElement).classList.add("hidden");
                  (event.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                }}
              />
              <div className="hidden text-xs text-text-tertiary px-3 py-2">{imageLoadFailedLabel}</div>
            </div>
          ))}
        </div>
      )}

      {otherFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherFiles.map((file, index) => (
            <a
              key={`${file.public_id}-${index}`}
              href={`/api/files/${file.public_id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border hover:border-brand/30 transition-colors"
            >
              <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
              <span className="text-[13px] text-text-secondary truncate max-w-[200px]">{file.filename}</span>
            </a>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        {message.content ? (
          <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{message.content}</p>
        ) : null}
      </div>
    </div>
  );
}

export default UserMessageContent;
