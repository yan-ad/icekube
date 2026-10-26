import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconPlus, IconRefresh, IconLink } from "@tabler/icons-react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCatalog } from "./CatalogProvider";
import { IconButton } from "@astryxdesign/core/IconButton";

export function CatalogRefreshButton() {
  const { run, busy, available } = useCatalog();
  return (
    <IconButton
      label="Refresh catalog"
      tooltip="Refresh catalog"
      icon={<Icon icon={IconRefresh} />}
      variant="ghost"
      isDisabled={busy || !available}
      onClick={() => void run("catalog_list")}
    />
  );
}

export function CatalogForms() {
  const { run, busy, available, error, snapshot } = useCatalog();
  const [mode, setMode] = useState<"import" | "link" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  function close() {
    if (!busy) {
      setMode(null);
      setPath("");
      setName("");
      setUrl("");
    }
  }
  async function submit() {
    const saved =
      mode === "import"
        ? await run("catalog_import_kubeconfig", { path })
        : await run("catalog_add_web_link", { name, url });
    if (saved) {
      setMode(null);
      setPath("");
      setName("");
      setUrl("");
    }
  }
  const disabled = busy || !available || !snapshot;
  return (
    <>
      <HStack gap={2} style={{ flexShrink: 0 }}>
          <IconButton
            label="Add config"
            tooltip="Add config"
            icon={<Icon icon={IconPlus} />}
            variant="primary"
            size="lg"
            elevation="med"
            style={{ borderRadius: "var(--radius-container)", minWidth: "calc(var(--spacing-10) + var(--spacing-1))", minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
            isDisabled={disabled}
            onClick={() => setMode("import")}
          />
          <IconButton
            label="Add web link"
            tooltip="Add web link"
            icon={<Icon icon={IconLink} />}
            variant="primary"
            size="lg"
            elevation="med"
            style={{ borderRadius: "var(--radius-container)", minWidth: "calc(var(--spacing-10) + var(--spacing-1))", minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
            isDisabled={disabled}
            onClick={() => setMode("link")}
          />
      </HStack>
      <Dialog
        isOpen={mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        purpose={busy ? "required" : "form"}
      >
        <Layout
          header={
            <DialogHeader
              title={mode === "import" ? "Import kubeconfig" : "Add web link"}
              onOpenChange={busy ? undefined : () => close()}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={4}>
                {mode === "import" ? (
                  <>
                    <Text as="p">
                      Import context names from an explicit file, up to 1 MiB.
                      Credentials stay out of the catalog. No connections or
                      authentication commands will run.
                    </Text>
                    <TextInput
                      label="Kubeconfig path"
                      value={path}
                      onChange={setPath}
                      isRequired
                      isDisabled={busy}
                      autoComplete="off"
                      description="Absolute path to a kubeconfig file or symbolic link. The resolved target must be a readable regular file, up to 1 MiB."
                    />
                  </>
                ) : (
                  <>
                    <TextInput
                      label="Name"
                      value={name}
                      onChange={setName}
                      isRequired
                      isDisabled={busy}
                      autoComplete="off"
                    />
                    <TextInput
                      label="URL"
                      value={url}
                      onChange={setUrl}
                      isRequired
                      isDisabled={busy}
                      autoComplete="off"
                      description="HTTP(S) only. No credentials, query parameters, or fragments. Links are stored without contacting the website."
                    />
                  </>
                )}
                {error && <Text role="alert">{error}</Text>}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button
                  label="Cancel"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={close}
                />
                <Button
                  label={
                    busy
                      ? "Saving…"
                      : mode === "import"
                        ? "Import contexts"
                        : "Save web link"
                  }
                  isDisabled={
                    busy ||
                    (mode === "import"
                      ? !path.trim()
                      : !name.trim() || !url.trim())
                  }
                  onClick={() => void submit()}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </>
  );
}
