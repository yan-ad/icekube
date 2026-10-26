import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { preferencesMessage, type AppTheme, type LineNumbers, type MinimapSide, type Preferences, type TerminalTheme } from "./api";
import { usePreferences } from "./PreferencesProvider";

type SectionId = "app" | "proxy" | "kubernetes" | "editor" | "terminal";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "app", label: "App" },
  { id: "proxy", label: "Proxy" },
  { id: "kubernetes", label: "Kubernetes" },
  { id: "editor", label: "Editor" },
  { id: "terminal", label: "Terminal" },
];

const THEME_OPTIONS = [
  { label: "System default", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const TIMEZONE_OPTIONS = [
  { label: "System default", value: "system" },
  { label: "UTC", value: "UTC" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Asia/Tokyo", value: "Asia/Tokyo" },
];

const LINE_NUMBER_OPTIONS = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
  { label: "Relative", value: "relative" },
  { label: "Interval", value: "interval" },
];

const MINIMAP_SIDE_OPTIONS = [
  { label: "Right", value: "right" },
  { label: "Left", value: "left" },
];

const TERMINAL_THEME_OPTIONS = [
  { label: "Match Freelens Theme", value: "match" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
];

export function PreferencesDialog() {
  const { preferences, isOpen, closePreferences, save, reset } = usePreferences();
  const [section, setSection] = useState<SectionId>("app");
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(preferences);
      setError(null);
      setStatus(null);
    }
  }, [isOpen, preferences]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await save(draft);
      setStatus("Preferences saved.");
      setTimeout(() => {
        closePreferences();
      }, 500);
    } catch (reason) {
      setError(preferencesMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      await reset();
      setStatus("Preferences reset to defaults.");
      closePreferences();
    } catch (reason) {
      setError(preferencesMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen
      purpose="form"
      width="min(44rem, 100%)"
      onOpenChange={open => { if (!open) closePreferences(); }}
    >
      <DialogHeader title="Preferences" />
      <HStack gap={4} style={{ flex: 1, minHeight: "380px", overflow: "hidden", padding: "var(--spacing-3) 0" }}>
        {/* Left Navigation */}
        <VStack
          gap={1}
          style={{
            width: "140px",
            flexShrink: 0,
            borderRight: "1px solid var(--color-border-subtle, rgba(255,255,255,0.1))",
            paddingRight: "var(--spacing-2)",
          }}
        >
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              label={s.label}
              variant={section === s.id ? "secondary" : "ghost"}
              size="sm"
              style={{ justifyContent: "flex-start", width: "100%" }}
              onClick={() => {
                setSection(s.id);
                setError(null);
                setStatus(null);
              }}
            />
          ))}
        </VStack>

        {/* Right Content Pane */}
        <VStack gap={4} style={{ flex: 1, overflowY: "auto", paddingRight: "var(--spacing-2)" }}>
          {section === "app" && (
            <VStack gap={3} aria-label="App preferences">
              <Text weight="bold">Application Settings</Text>
              <Selector
                label="Color Theme"
                value={draft.app.theme}
                options={THEME_OPTIONS}
                onChange={(value) => setDraft((d) => ({ ...d, app: { ...d.app, theme: value as AppTheme } }))}
              />
              <Selector
                label="Locale Timezone"
                value={draft.app.timezone}
                options={TIMEZONE_OPTIONS}
                onChange={(value) => setDraft((d) => ({ ...d, app: { ...d.app, timezone: value } }))}
              />
              <Switch
                label="Persistent search"
                description="Keep search terms when navigating across resources"
                value={draft.app.persistentSearch}
                onChange={(checked) => setDraft((d) => ({ ...d, app: { ...d.app, persistentSearch: checked } }))}
              />
              <Switch
                label="Start-up"
                description="Automatically start Icekube on login"
                value={draft.app.openAtLogin}
                onChange={(checked) => setDraft((d) => ({ ...d, app: { ...d.app, openAtLogin: checked } }))}
              />
              <Switch
                label="Menu-bar Settings"
                description="Show tray icon in the menu bar"
                value={draft.app.showTrayIcon}
                onChange={(checked) => setDraft((d) => ({ ...d, app: { ...d.app, showTrayIcon: checked } }))}
              />
            </VStack>
          )}

          {section === "proxy" && (
            <VStack gap={3} aria-label="Proxy preferences">
              <Text weight="bold">Proxy Settings</Text>
              <TextInput
                label="HTTP / HTTPS Proxy URL"
                placeholder="e.g. http://127.0.0.1:8080"
                value={draft.proxy.httpsProxy}
                onChange={(value) => setDraft((d) => ({ ...d, proxy: { ...d.proxy, httpsProxy: value } }))}
              />
              <Switch
                label="Certificate Trust"
                description="Allow untrusted Certificate Authorities (needed with corporate proxies re-writing certificates)"
                value={draft.proxy.allowUntrustedCas}
                onChange={(checked) => setDraft((d) => ({ ...d, proxy: { ...d.proxy, allowUntrustedCas: checked } }))}
              />
            </VStack>
          )}

          {section === "kubernetes" && (
            <VStack gap={3} aria-label="Kubernetes preferences">
              <Text weight="bold">Kubernetes & Helm</Text>
              <TextInput
                label="Helm Binaries Path"
                placeholder="Path to helm executable (leave empty for PATH lookup)"
                value={draft.kubernetes.helmBinaryPath}
                onChange={(value) => setDraft((d) => ({ ...d, kubernetes: { ...d.kubernetes, helmBinaryPath: value } }))}
              />
              <Switch
                label="Server-side apply"
                description="Use server-side apply (--server-side=true) for Helm chart operations"
                value={draft.kubernetes.helmServerSide}
                onChange={(checked) => setDraft((d) => ({ ...d, kubernetes: { ...d.kubernetes, helmServerSide: checked } }))}
              />
              <Switch
                label="Kubeconfig discovery"
                description="Automatically discover and sync ~/.kube/config on startup and refresh"
                value={draft.kubernetes.discoverDefaultKubeconfig}
                onChange={(checked) => setDraft((d) => ({ ...d, kubernetes: { ...d.kubernetes, discoverDefaultKubeconfig: checked } }))}
              />
            </VStack>
          )}

          {section === "editor" && (
            <VStack gap={3} aria-label="Editor preferences">
              <Text weight="bold">Editor Configuration</Text>
              <HStack gap={3}>
                <TextInput
                  label="Font size"
                  value={String(draft.editor.fontSize)}
                  onChange={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) setDraft((d) => ({ ...d, editor: { ...d.editor, fontSize: num } }));
                  }}
                />
                <TextInput
                  label="Tab size"
                  value={String(draft.editor.tabSize)}
                  onChange={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) setDraft((d) => ({ ...d, editor: { ...d.editor, tabSize: num } }));
                  }}
                />
              </HStack>
              <TextInput
                label="Font family"
                value={draft.editor.fontFamily}
                onChange={(value) => setDraft((d) => ({ ...d, editor: { ...d.editor, fontFamily: value } }))}
              />
              <Selector
                label="Line numbers"
                value={draft.editor.lineNumbers}
                options={LINE_NUMBER_OPTIONS}
                onChange={(value) => setDraft((d) => ({ ...d, editor: { ...d.editor, lineNumbers: value as LineNumbers } }))}
              />
              <HStack gap={3} vAlign="center">
                <Switch
                  label="Minimap"
                  description="Show code minimap"
                  value={draft.editor.minimap}
                  onChange={(checked) => setDraft((d) => ({ ...d, editor: { ...d.editor, minimap: checked } }))}
                />
                <Selector
                  label="Minimap position"
                  value={draft.editor.minimapSide}
                  options={MINIMAP_SIDE_OPTIONS}
                  onChange={(value) => setDraft((d) => ({ ...d, editor: { ...d.editor, minimapSide: value as MinimapSide } }))}
                />
              </HStack>
            </VStack>
          )}

          {section === "terminal" && (
            <VStack gap={3} aria-label="Terminal preferences">
              <Text weight="bold">Terminal Configuration</Text>
              <TextInput
                label="Font size"
                value={String(draft.terminal.fontSize)}
                onChange={(val) => {
                  const num = parseInt(val, 10);
                  if (!isNaN(num)) setDraft((d) => ({ ...d, terminal: { ...d.terminal, fontSize: num } }));
                }}
              />
              <TextInput
                label="Font family"
                value={draft.terminal.fontFamily}
                onChange={(value) => setDraft((d) => ({ ...d, terminal: { ...d.terminal, fontFamily: value } }))}
              />
              <Selector
                label="Terminal theme"
                value={draft.terminal.theme}
                options={TERMINAL_THEME_OPTIONS}
                onChange={(value) => setDraft((d) => ({ ...d, terminal: { ...d.terminal, theme: value as TerminalTheme } }))}
              />
              <Switch
                label="Terminal copy & paste"
                description="Copy on select and paste on right-click"
                value={draft.terminal.copyOnSelect}
                onChange={(checked) => setDraft((d) => ({ ...d, terminal: { ...d.terminal, copyOnSelect: checked } }))}
              />
              <TextInput
                label="Terminal Shell Path"
                placeholder="Default system shell"
                value={draft.terminal.shellPath}
                onChange={(value) => setDraft((d) => ({ ...d, terminal: { ...d.terminal, shellPath: value } }))}
              />
            </VStack>
          )}
        </VStack>
      </HStack>

      {/* Messages */}
      {error && <Text role="alert" style={{ color: "var(--color-danger, #ff4d4f)" }}>{error}</Text>}
      {status && <Text role="status" style={{ color: "var(--color-success, #52c41a)" }}>{status}</Text>}

      {/* Footer Actions */}
      <HStack gap={2} hAlign="end" style={{ paddingTop: "var(--spacing-3)", borderTop: "1px solid var(--color-border-subtle, rgba(255,255,255,0.1))" }}>
        <Button label="Reset to defaults" variant="ghost" onClick={() => void handleReset()} isDisabled={saving} />
        <Button label="Cancel" variant="secondary" onClick={closePreferences} isDisabled={saving} />
        <Button label="Save changes" variant="primary" isLoading={saving} onClick={() => void handleSave()} />
      </HStack>
    </Dialog>
  );
}
