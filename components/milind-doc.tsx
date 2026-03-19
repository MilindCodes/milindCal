"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Calendar,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DOCS_KEY, TASK_STORAGE_KEY } from "@/lib/models";
import type { Task } from "@/lib/models";

interface MilindDocProps {
  onAddToCalendar: (title: string, description: string) => void;
  onAddToTodo: (title: string) => void;
}

function extractTitle(editor: Editor | null): string {
  if (!editor) return "Untitled";
  const json = editor.getJSON();
  for (const node of json.content ?? []) {
    if (node.type === "heading" || node.type === "paragraph") {
      const text = (node.content ?? []).map((c: unknown) => (c as { text?: string }).text ?? "").join("");
      if (text.trim()) return text.trim();
    }
  }
  return "Untitled";
}

function nodeToText(node: { type?: string; content?: unknown[]; text?: string }): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  const inner = (node.content as typeof node[]).map(nodeToText).join("");
  // Add newlines for block-level nodes
  if (node.type && ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type)) {
    return inner + "\n";
  }
  return inner;
}

function extractDescription(editor: Editor | null): string {
  if (!editor) return "";
  const json = editor.getJSON();
  const nodes = json.content ?? [];
  // Skip the first non-empty block (the title)
  let skippedTitle = false;
  const lines: string[] = [];
  for (const node of nodes) {
    const text = nodeToText(node as Parameters<typeof nodeToText>[0]);
    if (!skippedTitle && text.trim()) {
      skippedTitle = true;
      continue;
    }
    lines.push(text);
  }
  return lines.join("").trim();
}

function loadDocContent() {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function MilindDoc({ onAddToCalendar, onAddToTodo }: MilindDocProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: "Start writing your milindDoc…",
      }),
    ],
    content: loadDocContent() ?? undefined,
    onUpdate: ({ editor: e }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(DOCS_KEY, JSON.stringify(e.getJSON()));
          setSavedFeedback(true);
          if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
          savedFeedbackTimerRef.current = setTimeout(() => setSavedFeedback(false), 1500);
        } catch { /* quota */ }
      }, 500);
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
    };
  }, []);

  const handleAddToCalendar = useCallback(() => {
    onAddToCalendar(extractTitle(editor), extractDescription(editor));
  }, [editor, onAddToCalendar]);

  const handleAddToTodo = useCallback(() => {
    const title = extractTitle(editor);
    try {
      const raw = localStorage.getItem(TASK_STORAGE_KEY);
      const tasks: Task[] = raw ? JSON.parse(raw) : [];
      const newTask: Task = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        completed: false,
        createdAt: Date.now(),
        importance: "medium",
        source: "local",
      };
      localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify([...tasks, newTask]));
    } catch { /* quota */ }
    onAddToTodo(title);
  }, [editor, onAddToTodo]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const tb = (active: boolean) => `doc-toolbar-btn${active ? " active" : ""}`;

  return (
    <div className="milind-doc">
      <div className="milind-doc-header">
        <span className="milind-doc-brand">milindDoc</span>
        <div className="milind-doc-actions">
          {savedFeedback && <span className="doc-saved-badge">Saved</span>}
          <button className="doc-action-btn" onClick={handleAddToCalendar} type="button">
            <Calendar size={13} /> Add to calendar
          </button>
          <button className="doc-action-btn" onClick={handleAddToTodo} type="button">
            <ListTodo size={13} /> Add to to-do
          </button>
        </div>
      </div>

      <div className="doc-toolbar">
        <button
          className={tb(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
          type="button"
        >
          <Bold size={13} />
        </button>
        <button
          className={tb(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
          type="button"
        >
          <Italic size={13} />
        </button>
        <button
          className={tb(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
          type="button"
        >
          <UnderlineIcon size={13} />
        </button>
        <div className="doc-toolbar-divider" />
        <button
          className={tb(editor.isActive("heading", { level: 1 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
          type="button"
        >
          <Heading1 size={13} />
        </button>
        <button
          className={tb(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
          type="button"
        >
          <Heading2 size={13} />
        </button>
        <button
          className={tb(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
          type="button"
        >
          <Heading3 size={13} />
        </button>
        <div className="doc-toolbar-divider" />
        <button
          className={tb(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
          type="button"
        >
          <List size={13} />
        </button>
        <button
          className={tb(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered list"
          type="button"
        >
          <ListOrdered size={13} />
        </button>
        <button
          className={tb(editor.isActive("codeBlock"))}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Code block"
          type="button"
        >
          <Code size={13} />
        </button>
        <button
          className={tb(editor.isActive("link"))}
          onClick={setLink}
          title="Link"
          type="button"
        >
          <LinkIcon size={13} />
        </button>
      </div>

      <EditorContent className="milind-doc-content" editor={editor} />
    </div>
  );
}
