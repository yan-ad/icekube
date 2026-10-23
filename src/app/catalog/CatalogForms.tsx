import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCatalog } from "./CatalogProvider";

export function CatalogForms() {
  const { run, busy, available, error, snapshot } = useCatalog();
  const [mode, setMode] = useState<"import" | "link" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  function close() { if (!busy) { setMode(null); setPath(""); setName(""); setUrl(""); } }
  async function submit() {
    const saved = mode === "import"
      ? await run("catalog_import_kubeconfig", { path })
      : await run("catalog_add_web_link", { name, url });
    if (saved) { setMode(null); setPath(""); setName(""); setUrl(""); }
  }
  const disabled = busy || !available || !snapshot;
  return <>
    <HStack gap={2} wrap="wrap">
      <Button label="Import kubeconfig" variant="ghost" isDisabled={disabled} onClick={() => setMode("import")} />
      <Button label="Add web link" variant="ghost" isDisabled={disabled} onClick={() => setMode("link")} />
      <Button label="Refresh catalog" variant="ghost" isDisabled={busy || !available} onClick={() => void run("catalog_list")} />
    </HStack>
    <Dialog isOpen={mode !== null} onOpenChange={(open) => { if (!open) close(); }} purpose={busy ? "required" : "form"}>
      <Layout header={<DialogHeader title={mode === "import" ? "Import kubeconfig" : "Add web link"} onOpenChange={busy ? undefined : () => close()} />}
        content={<LayoutContent><VStack gap={4}>
          {mode === "import" ? <>
            <Text as="p">Import context names from an explicit file, up to 1 MiB. Credentials stay out of the catalog. No connections or authentication commands will run.</Text>
            <TextInput label="Kubeconfig path" value={path} onChange={setPath} isRequired isDisabled={busy} autoComplete="off" description="Absolute path to a regular file. Symbolic links are not supported." />
          </> : <>
            <TextInput label="Name" value={name} onChange={setName} isRequired isDisabled={busy} autoComplete="off" />
            <TextInput label="URL" value={url} onChange={setUrl} isRequired isDisabled={busy} autoComplete="off" description="HTTP(S) only. No credentials, query parameters, or fragments. Links are stored without contacting the website." />
          </>}
          {error && <Text role="alert">{error}</Text>}
        </VStack></LayoutContent>}
        footer={<LayoutFooter hasDivider><HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" isDisabled={busy} onClick={close} />
          <Button label={busy ? "Saving…" : mode === "import" ? "Import contexts" : "Save web link"} isDisabled={busy || (mode === "import" ? !path.trim() : !name.trim() || !url.trim())} onClick={() => void submit()} />
        </HStack></LayoutFooter>} />
    </Dialog>
  </>;
}
