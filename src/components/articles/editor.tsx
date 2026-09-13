"use client";
import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function ToolbarButton({ label, on, active, disabled }: { label: string; on: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Button type="button" size="sm" variant={active ? "secondary" : "outline"} onClick={on} disabled={disabled}>
      {label}
    </Button>
  );
}

export function RichEditor({ value, onChange, onPickImage }: { value: string; onChange: (html: string) => void; onPickImage: () => Promise<{ url: string; alt: string } | null> }) {
  const [source, setSource] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false }), Link.configure({ openOnClick: false }), Image],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: "prose prose-neutral max-w-none min-h-[420px] rounded-md border p-4 focus:outline-none" } },
  });
  // Keep the visual editor in sync when leaving source mode.
  useEffect(() => {
    if (!source && editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  if (!editor) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <ToolbarButton disabled={source} label="H2" on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} />
        <ToolbarButton disabled={source} label="H3" on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} />
        <ToolbarButton disabled={source} label="B" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} />
        <ToolbarButton disabled={source} label="I" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} />
        <ToolbarButton disabled={source} label="• List" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} />
        <ToolbarButton disabled={source} label="1. List" on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} />
        <ToolbarButton disabled={source}
          label="Link"
          on={() => {
            const url = prompt("Link URL", editor.getAttributes("link").href ?? "https://");
            if (url === null) return;
            if (url === "") editor.chain().focus().unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }}
          active={editor.isActive("link")}
        />
        <ToolbarButton disabled={source}
          label="Image"
          on={async () => {
            const img = await onPickImage();
            if (img) editor.chain().focus().setImage({ src: img.url, alt: img.alt }).run();
          }}
        />
        <Button type="button" size="sm" variant={source ? "secondary" : "outline"} onClick={() => setSource(!source)}>
          {source ? "Visual" : "HTML"}
        </Button>
      </div>
      {source ? <Textarea rows={24} className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} /> : <EditorContent editor={editor} />}
    </div>
  );
}
