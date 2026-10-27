import { useEffect, useId, useRef } from "react";
import { CodeJar, type CodeJar as CodeJarInstance } from "codejar";
import hljs from "highlight.js/lib/core";
import yaml from "highlight.js/lib/languages/yaml";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

hljs.registerLanguage("yaml", yaml);

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isReadOnly?: boolean;
  rows?: number;
};

function highlightYaml(element: HTMLElement) {
  // highlight() escapes source text; never interpret YAML as HTML.
  element.innerHTML = hljs.highlight(element.textContent ?? "", { language: "yaml", ignoreIllegals: true }).value;
}

export function YamlEditor({ label, value, onChange, isReadOnly = false, rows = 14 }: Props) {
  const id = useId();
  const editorRef = useRef<HTMLPreElement>(null);
  const jarRef = useRef<CodeJarInstance | null>(null);
  const composing = useRef(false);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    composing.current = false;
    if (editor.textContent !== latest.current.value) {
      editor.textContent = latest.current.value;
      highlightYaml(editor);
    }
    if (isReadOnly) {
      editor.contentEditable = "false";
      return;
    }

    let disposed = false;
    let published = latest.current.value;
    const ownsSelection = () => {
      const selection = window.getSelection();
      return document.activeElement === editor && selection?.anchorNode && selection.focusNode &&
        editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
    };
    // CodeJar observes keyup/paste/cut, but not input or compositionend.
    const readCode = () => editor.querySelector("br")
      ? editor.innerText.replace(/\n$/, "") : editor.textContent ?? "";
    const publish = () => {
      const code = readCode();
      if (!disposed && !composing.current && code !== published) {
        published = code;
        latest.current.onChange(code);
      }
    };
    const startComposition = () => { composing.current = true; };
    const guardComposition = (event: KeyboardEvent) => {
      if (composing.current || event.isComposing || event.keyCode === 229) {
        event.stopImmediatePropagation();
      } else if (event.type === "keydown" && event.key === "Enter") {
        // Native contenteditable Enter inserts BR nodes, which CodeJar's textContent serialization drops.
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const before = selection.getRangeAt(0).cloneRange();
        before.selectNodeContents(editor);
        before.setEnd(selection.anchorNode!, selection.anchorOffset);
        const lines = before.toString().split("\n");
        const padding = lines[lines.length - 1]?.match(/^[ \t]*/)?.[0] ?? "";
        document.execCommand("insertHTML", false, `\n${padding}`);
        publish();
      }
    };
    editor.addEventListener("keydown", guardComposition, true);
    editor.addEventListener("keyup", guardComposition, true);
    const jar = CodeJar(editor, element => {
      // destroy() removes listeners, not CodeJar's already queued timers.
      if (!disposed && !composing.current) {
        if (editor.querySelector("br")) {
          const selection = window.getSelection();
          const range = ownsSelection() && selection?.rangeCount ? selection.getRangeAt(0) : null;
          const position = range ? range.cloneRange() : null;
          if (position) {
            position.selectNodeContents(editor);
            position.setEnd(range!.startContainer, range!.startOffset);
          }
          const offset = position?.toString().length ?? 0;
          editor.textContent = readCode();
          highlightYaml(element);
          if (position) jarRef.current?.restore({ start: offset, end: offset });
        } else highlightYaml(element);
      }
    }, {
      tab: "  ", addClosing: false, catchTab: false,
      window: new Proxy(window, {
        get(target, key) {
          if (key === "setTimeout") return (callback: () => void, delay: number) =>
            // CodeJar's debounce saves/restores selection outside the highlight callback.
            // A Tab keyup can queue it before blur; restoring then steals focus back.
            target.setTimeout(() => {
              if (!disposed && !composing.current && ownsSelection()) callback();
            }, delay);
          return Reflect.get(target, key);
        },
      }),
    });
    jarRef.current = jar;
    const endComposition = () => {
      composing.current = false;
      const position = ownsSelection() ? jar.save() : null;
      highlightYaml(editor);
      if (position) jar.restore(position);
      publish();
    };
    editor.style.removeProperty("outline");
    jar.onUpdate(publish);
    editor.addEventListener("input", publish);
    editor.addEventListener("compositionstart", startComposition);
    editor.addEventListener("compositionend", endComposition);
    return () => {
      disposed = true;
      jar.onUpdate(() => {});
      jar.destroy();
      jarRef.current = null;
      editor.removeEventListener("input", publish);
      editor.removeEventListener("compositionstart", startComposition);
      editor.removeEventListener("compositionend", endComposition);
      editor.removeEventListener("keydown", guardComposition, true);
      editor.removeEventListener("keyup", guardComposition, true);
    };
  }, [isReadOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || composing.current || editor.textContent === value) return;
    const jar = jarRef.current;
    const selection = window.getSelection();
    const position = jar && document.activeElement === editor && selection?.anchorNode && selection.focusNode &&
      editor.contains(selection.anchorNode) && editor.contains(selection.focusNode) ? jar.save() : null;
    if (jar) {
      jar.updateCode(value, false);
      if (position) jar.restore(position);
    } else {
      editor.textContent = value;
      highlightYaml(editor);
    }
  }, [value]);

  return <VStack gap={2} style={{ minWidth: 0 }}>
    <Text id={`${id}-label`}>{label}</Text>
    <pre ref={editorRef} className="yaml-editor" role="textbox" aria-multiline="true"
      aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} aria-readonly={isReadOnly}
      tabIndex={0} spellCheck={false} data-yaml-editor="true" style={{ minHeight: `${rows * 1.5}em`, maxHeight: `${rows * 1.5 + 6}em`, margin: 0 }} />
    <Text id={`${id}-help`} type="supporting">{isReadOnly ? "Read-only YAML. Tab moves to the next control." : "Indent with spaces. Tab moves to the next control; Shift+Tab moves back."}</Text>
  </VStack>;
}
