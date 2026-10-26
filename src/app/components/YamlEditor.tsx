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
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const jar = CodeJar(editor, highlightYaml, { tab: "  ", addClosing: false, catchTab: false });
    jarRef.current = jar;
    jar.updateCode(latest.current.value, false);
    // Read-only views must not retain CodeJar's paste, cut, undo or indent handlers.
    if (isReadOnly) {
      jar.destroy();
      editor.contentEditable = "false";
    }
    editor.style.removeProperty("outline");
    const update = () => latest.current.onChange(editor.innerText);
    if (!isReadOnly) jar.onUpdate(update);
    return () => {
      jar.onUpdate(() => {});
      jar.destroy();
      jarRef.current = null;
    };
  }, [isReadOnly]);

  useEffect(() => {
    const jar = jarRef.current;
    if (jar && jar.toString() !== value) jar.updateCode(value, false);
  }, [value]);

  return <VStack gap={2} style={{ minWidth: 0 }}>
    <Text id={`${id}-label`}>{label}</Text>
    <pre ref={editorRef} className="yaml-editor" role="textbox" aria-multiline="true"
      aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} aria-readonly={isReadOnly}
      tabIndex={0} spellCheck={false} data-yaml-editor="true" style={{ minHeight: `${rows * 1.5}em`, maxHeight: `${rows * 1.5 + 6}em`, margin: 0 }} />
    <Text id={`${id}-help`} type="supporting">{isReadOnly ? "Read-only YAML. Tab moves to the next control." : "Indent with spaces. Tab moves to the next control; Shift+Tab moves back."}</Text>
  </VStack>;
}
