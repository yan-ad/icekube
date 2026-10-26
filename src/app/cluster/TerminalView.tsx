import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { IconArrowDown, IconArrowUp, IconDownload, IconPlayerPause, IconPlayerPlay, IconRefresh, IconSearch, IconTextWrap, IconTrash } from "@tabler/icons-react";
import { podMessage, podStreamRead, podStreamResize, podStreamWrite, type PodStreamSnapshot } from "./podApi";

const LIMIT = 512 * 1024;
const encoder = new TextEncoder();
const INPUT_LIMIT = 64 * 1024;
const INPUT_CHUNK = 16 * 1024;
function codePointBytes(value: string): number {
  const point = value.codePointAt(0)!;
  return point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
}
function boundedInputChunks(data: string, available: number): { chunks: string[]; overflow: boolean } {
  const chunks: string[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;
  let accepted = 0;
  for (const char of data) {
    const size = codePointBytes(char);
    if (accepted + size > available) {
      if (chunk.length) chunks.push(chunk.join(""));
      return { chunks, overflow: true };
    }
    if (chunkBytes + size > INPUT_CHUNK) {
      chunks.push(chunk.join(""));
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(char);
    chunkBytes += size;
    accepted += size;
  }
  if (chunk.length) chunks.push(chunk.join(""));
  return { chunks, overflow: false };
}
export function boundedPodOutput(previous: string, next: string): { output: string; dropped: boolean } {
  const bytes = encoder.encode(previous + next);
  if (bytes.length <= LIMIT) return { output: previous + next, dropped: false };
  let start = bytes.length - LIMIT;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return { output: new TextDecoder().decode(bytes.subarray(start)), dropped: true };
}
export function TerminalView({ snapshot, logs, visible, toolbar, options, onRestart }: { snapshot: PodStreamSnapshot; logs: boolean; visible: boolean; toolbar: ReactNode; options: ReactNode; onRestart: () => void }) {
  const [buffer, setBuffer] = useState(snapshot.output);
  const [display, setDisplay] = useState(snapshot.output);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState(0);
  const [status, setStatus] = useState(snapshot.status);
  const [error, setError] = useState<string | null>(snapshot.error ? podMessage(snapshot.error) : null);
  const [dropped, setDropped] = useState(snapshot.truncated);
  const search = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const stream = useMemo(() => ({ clusterId: snapshot.clusterId, sessionId: snapshot.sessionId, streamId: snapshot.streamId }), [snapshot.clusterId, snapshot.sessionId, snapshot.streamId]);
  const all = useRef(snapshot.output);
  const sequence = useRef(snapshot.sequence);
  useEffect(() => {
    if (logs || !host.current) return;
    const term = new Terminal({ scrollback: 2000, convertEol: false, allowProposedApi: false });
    const addon = new FitAddon(); term.loadAddon(addon); term.open(host.current); terminal.current = term; fit.current = addon;
    term.write(snapshot.output);
    let disposed = false; let queued = 0; let writes: Promise<void> = Promise.resolve();
    const input = term.onData((data: string) => {
      const inputChunks = boundedInputChunks(data, INPUT_LIMIT - queued);
      for (const part of inputChunks.chunks) {
        const size = encoder.encode(part).length;
        queued += size;
        writes = writes.then(async () => { if (!disposed) await podStreamWrite(stream, part); }).catch(e => { if (!disposed) setError(podMessage(e)); }).finally(() => { queued -= size; });
      }
      if (inputChunks.overflow) setError("Terminal input queue is full. Wait before sending more input.");
    });
    let resizing = false; let again = false;
    const resize = async () => {
      if (!host.current?.offsetWidth || !host.current.offsetHeight || disposed) return;
      if (resizing) { again = true; return; }
      resizing = true;
      try { addon.fit(); await podStreamResize(stream, Math.min(1000, term.cols), Math.min(1000, term.rows)); }
      catch (e) { if (!disposed) setError(podMessage(e)); }
      finally { resizing = false; if (again && !disposed) { again = false; void resize(); } }
    };
    const observer = new ResizeObserver(() => void resize()); observer.observe(host.current); void resize();
    return () => { disposed = true; observer.disconnect(); input.dispose(); term.dispose(); terminal.current = null; fit.current = null; };
  }, [logs, stream]);
  useEffect(() => { if (visible && !logs) { fit.current?.fit(); if (document.activeElement?.getAttribute("role") !== "tab") terminal.current?.focus(); } }, [visible, logs]);
  useEffect(() => {
    let disposed = false; let timer: number | undefined;
    let queuedOutput = 0;
    const receive = async () => {
      try {
        const next = await podStreamRead(stream);
        if (disposed) return;
        if (next.sequence < sequence.current) throw "invalidResponse";
        sequence.current = next.sequence;
        const bounded = boundedPodOutput(all.current, next.output); all.current = bounded.output;
        setBuffer(bounded.output); setDropped(d => d || bounded.dropped || next.truncated); setStatus(next.status);
        if (next.error) setError(podMessage(next.error));
        if (logs && !pausedRef.current) setDisplay(bounded.output);
        if (!logs && next.output) {
          queuedOutput += encoder.encode(next.output).length;
          await new Promise<void>(resolve => terminal.current ? terminal.current.write(next.output, () => { queuedOutput = 0; resolve(); }) : resolve());
        }
        const finalRead = (next.status === "exited" || next.status === "error") && next.output.length === 0;
        if (!disposed && !finalRead && queuedOutput < LIMIT) timer = window.setTimeout(() => void receive(), 250);
      } catch (e) { if (!disposed) { setError(podMessage(e)); setStatus("error"); } }
    };
    if ((snapshot.status !== "exited" && snapshot.status !== "error") || snapshot.output.length > 0) timer = window.setTimeout(() => void receive(), 250);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [stream, logs]);
  useEffect(() => { if (logs && !paused && visible && !query && pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [display, paused, visible, query, logs]);
  const matches = useMemo(() => {
    if (!query) return [];
    const found: number[] = []; const lower = display.toLowerCase(); const needle = query.toLowerCase(); let start = 0;
    while (found.length < 10000) { const index = lower.indexOf(needle, start); if (index < 0) break; found.push(index); start = index + Math.max(needle.length, 1); }
    return found;
  }, [display, query]);
  const selected = matches.length ? matches[match % matches.length] : undefined;
  const marker = useRef<HTMLElement>(null);
  useEffect(() => { marker.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  function download(value: string, suffix: string) {
    const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `pod-${suffix}.log`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <VStack gap={0} style={{ flex: 1, minHeight: 0, overflow: "hidden" }} onKeyDown={e => {
    if (logs && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); e.stopPropagation(); search.current?.focus(); search.current?.select(); }
    if (logs && e.target === search.current && e.key === "Enter") { e.preventDefault(); if (matches.length) setMatch(n => (n + (e.shiftKey ? -1 : 1) + matches.length) % matches.length); }
  }}>
    <HStack gap={2} paddingInline={2} paddingBlock={1} vAlign="center" wrap="wrap" aria-label="Stream toolbar" style={{ flexShrink: 0, minWidth: 0, borderBlockEnd: "var(--spacing-px, thin) solid var(--color-border)" }}>
      <HStack gap={2} vAlign="center" style={{ minWidth: 0, flex: "1 1 auto" }}>{toolbar}</HStack>
      {logs && <HStack gap={1} vAlign="center" style={{ minWidth: 0, flex: "1 1 calc(var(--spacing-10) * 7)", maxWidth: "100%" }}>
        <TextInput ref={search} size="sm" containerStyle={{ flex: 1, minWidth: 0 }} isLabelHidden startIcon={IconSearch} label="Search buffered logs" placeholder="Search logs…" value={query} onChange={value => { setQuery(value); setMatch(0); }} />
        <IconButton label="Previous match" tooltip="Previous match (Shift+Enter)" icon={<Icon icon={IconArrowUp} />} size="sm" variant="ghost" isDisabled={!matches.length} onClick={() => setMatch(n => (n - 1 + matches.length) % matches.length)} />
        <IconButton label="Next match" tooltip="Next match (Enter)" icon={<Icon icon={IconArrowDown} />} size="sm" variant="ghost" isDisabled={!matches.length} onClick={() => setMatch(n => (n + 1) % matches.length)} />
        {query && <Text as="p" color="secondary" style={{ whiteSpace: "nowrap" }}>{`${matches.length ? match % matches.length + 1 : 0}/${matches.length}${matches.length === 10000 ? "+" : ""} matches`}</Text>}
      </HStack>}
    </HStack>
    {error && <Text role="alert">{error}</Text>}
    {logs ? <pre ref={pre} tabIndex={0} aria-label="Pod logs" style={{ flex: 1, minHeight: 0, overflow: "auto", whiteSpace: wrap ? "pre-wrap" : "pre", overflowWrap: wrap ? "anywhere" : "normal", margin: 0, padding: "var(--spacing-2)", fontFamily: "var(--font-family-code)", backgroundColor: "var(--color-log-background)", color: "var(--color-log-text)" }}>{selected === undefined ? display || "Waiting for output…" : <>{display.slice(0, selected)}<mark ref={marker} style={{ backgroundColor: "var(--color-log-match-background)", color: "var(--color-log-match-text)" }}>{display.slice(selected, selected + query.length)}</mark>{display.slice(selected + query.length)}</>}</pre> : <VStack ref={host} aria-label="Pod terminal" style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "var(--spacing-2)" }} />}
    <HStack gap={1} paddingInline={2} paddingBlock={1} vAlign="center" aria-label="Stream controls" style={{ flexShrink: 0, minWidth: 0, overflowX: "auto", borderBlockStart: "var(--spacing-px, thin) solid var(--color-border)" }}>
      <Text as="p" role="status" style={{ whiteSpace: "nowrap" }}>{status}{dropped ? " · partial output: earlier bytes dropped" : ""}</Text>
      <StackItem size="fill" />
      {options}
      {logs && <>
        <IconButton label={paused ? "Resume follow" : "Pause follow"} tooltip={paused ? "Resume follow" : "Pause follow"} icon={<Icon icon={paused ? IconPlayerPlay : IconPlayerPause} />} size="sm" variant="ghost" aria-pressed={paused} onClick={() => { pausedRef.current = !paused; setPaused(!paused); if (paused) setDisplay(all.current); }} />
        <IconButton label={wrap ? "No wrap" : "Wrap lines"} tooltip="Word wrap" icon={<Icon icon={IconTextWrap} />} size="sm" variant="ghost" aria-pressed={wrap} onClick={() => setWrap(!wrap)} />
      </>}
      <IconButton label="Restart stream" tooltip="Restart stream" icon={<Icon icon={IconRefresh} />} size="sm" variant="ghost" onClick={onRestart} />
      <IconButton label="Clear" tooltip="Clear buffered output" icon={<Icon icon={IconTrash} />} size="sm" variant="ghost" onClick={() => { all.current = ""; setBuffer(""); setDisplay(""); terminal.current?.clear(); }} />
      <DropdownMenu presentation="popover" placement="above" alignment="end" hasChevron={false} renderTrigger={props => <IconButton {...props} label="Download output" tooltip="Download output" icon={<Icon icon={IconDownload} />} size="sm" variant="ghost" />}
        items={[{ label: "Download buffered", onClick: () => download(buffer, "buffered") }, ...(logs ? [{ label: "Download visible snapshot", onClick: () => download(display, "visible") }] : [])]} />
    </HStack>
  </VStack>;
}
