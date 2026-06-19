"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Info, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export type NotebookNoteEditorDialogProps = {
  open: boolean;
  saving?: boolean;
  initialTitle?: string;
  initialContent?: string;
  onClose: () => void;
  onSave: (note: { title: string; content: string }) => void;
};

function escapeNoteHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function noteContentToHtml(value?: string) {
  const content = value || "";
  if (/<\/?[a-z][\s\S]*>/i.test(content)) return content;
  return escapeNoteHtml(content).replace(/\n/g, "<br />");
}

function noteContentPreview(value?: string) {
  if (!value) return "";
  if (typeof document === "undefined") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
  const el = document.createElement("div");
  el.innerHTML = value;
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim() || "";
}

function noteHasRichEmptyBlock(value?: string) {
  return /<(h1|h2|ul|ol|li|blockquote|hr)\b/i.test(value || "");
}

export function NotebookNoteEditorDialog({ open, saving, initialTitle, initialContent, onClose, onSave }: NotebookNoteEditorDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialTitle || t("notebook.newNote"));
  const [content, setContent] = useState(noteContentToHtml(initialContent));
  const [editorFocused, setEditorFocused] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
      }),
      Underline,
    ],
    content: noteContentToHtml(initialContent),
    editorProps: {
      attributes: {
        class:
          "notebook-note-editor min-h-[440px] max-w-none text-[15px] leading-7 text-text-primary outline-none [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-brand/40 [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_hr]:my-5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-surface-border [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6",
      },
      handleDOMEvents: {
        focus: () => {
          setEditorFocused(true);
          return false;
        },
        blur: () => {
          setEditorFocused(false);
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML());
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!open) return;
    const nextContent = noteContentToHtml(initialContent);
    setTitle(initialTitle || t("notebook.newNote"));
    setContent(nextContent);
    setEditorFocused(false);
    editor?.commands.setContent(nextContent, { emitUpdate: false });
  }, [editor, initialContent, initialTitle, open]);

  if (!open) return null;

  const syncContent = () => {
    const html = editor?.getHTML() || "";
    setContent(html);
    return html;
  };

  const runEditor = (callback: (editor: Editor) => void) => {
    if (!editor) return;
    setEditorFocused(true);
    editor.chain().focus().run();
    callback(editor);
    setContent(editor.getHTML());
  };

  const plainContent = noteContentPreview(content);
  const showPlaceholder = !editorFocused && !plainContent && !noteHasRichEmptyBlock(content);
  const canSave = title.trim() || !!plainContent;
  const toolbarButton = "rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-hover hover:text-text-primary";
  const toolbarActiveButton = "bg-surface-hover text-text-primary shadow-sm";
  const toolbarDivider = <span className="mx-1 h-5 w-px bg-surface-border" />;
  const buttonClass = (active?: boolean) => cn(toolbarButton, active && toolbarActiveButton);

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[min(820px,90vh)] w-[min(860px,94vw)] flex-col overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
          <div className="text-sm font-medium text-text-tertiary">Studio &gt; {t("notebook.notes")}</div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title={t("notebook.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-7 py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-w-0 flex-1 border-none bg-transparent text-[30px] font-bold leading-tight tracking-[-0.04em] text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder={t("notebook.newNote")}
            />
            <Trash2 className="h-5 w-5 shrink-0 text-text-tertiary" />
          </div>
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1.5 rounded-2xl border border-surface-border bg-surface-elevated/95 px-3 py-2 text-xs text-text-secondary shadow-sm backdrop-blur">
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().undo().run()); }} className={toolbarButton}>↶</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().redo().run()); }} className={toolbarButton}>↷</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().setParagraph().run()); }} className={buttonClass(editor?.isActive("paragraph"))}>{t("notebook.editor.paragraph")}</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()); }} className={buttonClass(editor?.isActive("heading", { level: 1 }))}>{t("notebook.editor.heading1")}</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()); }} className={buttonClass(editor?.isActive("heading", { level: 2 }))}>{t("notebook.editor.heading2")}</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleBold().run()); }} className={buttonClass(editor?.isActive("bold"))}>B</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleItalic().run()); }} className={buttonClass(editor?.isActive("italic"))}>I</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleUnderline().run()); }} className={buttonClass(editor?.isActive("underline"))}>U</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleBulletList().run()); }} className={buttonClass(editor?.isActive("bulletList"))}>{t("notebook.editor.bulletList")}</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleOrderedList().run()); }} className={buttonClass(editor?.isActive("orderedList"))}>{t("notebook.editor.orderedList")}</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().toggleBlockquote().run()); }} className={buttonClass(editor?.isActive("blockquote"))}>{t("notebook.editor.blockquote")}</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().setHorizontalRule().run()); }} className={toolbarButton}>{t("notebook.editor.divider")}</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runEditor((editor) => editor.chain().focus().unsetAllMarks().clearNodes().run()); }} className={toolbarButton}>{t("notebook.editor.clearFormat")}</button>
          </div>
          <div className="relative rounded-3xl border border-surface-border bg-surface px-5 py-5 shadow-inner">
            {showPlaceholder && (
              <div className="pointer-events-none absolute left-5 top-5 text-[15px] leading-7 text-text-tertiary">
                {t("notebook.editor.placeholder")}
              </div>
            )}
            <EditorContent editor={editor} />
          </div>
          <div className="mt-3 rounded-2xl bg-surface-elevated px-4 py-3 text-xs leading-5 text-text-tertiary">
            {t("notebook.editor.shortcuts")}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-surface-border px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Info className="h-4 w-4" />
            <span>{t("notebook.editor.maxNotes")}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">{t("common.cancel")}</button>
            <button type="button" onClick={() => canSave && onSave({ title: title.trim() || t("notebook.untitledNote"), content: syncContent() })} disabled={saving || !canSave} className="inline-flex items-center gap-2 rounded-full bg-surface-elevated px-5 py-2 text-sm font-semibold text-text-primary transition hover:bg-surface-hover disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("notebook.editor.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
