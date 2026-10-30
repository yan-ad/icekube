import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconPlus, IconRefresh, IconFolder } from "@tabler/icons-react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCatalog } from "./CatalogProvider";
import { IconButton } from "@astryxdesign/core/IconButton";
import { chooseKubeconfig, filePickerError } from "./filePicker";

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
  const [isOpen, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerSession = useRef(0);
  const pickerPending = useRef(false);
  useEffect(() => () => { pickerSession.current += 1; }, []);
  function invalidatePicker() {
    pickerSession.current += 1;
    pickerPending.current = false;
    setPicking(false);
    setPickerError(null);
  }
  function open() {
    invalidatePicker();
    setOpen(true);
  }
  async function chooseFile() {
    if (pickerPending.current || busy || !available || !isOpen) return;
    pickerPending.current = true;
    setPicking(true);
    setPickerError(null);
    const session = pickerSession.current;
    try {
      const selected = await chooseKubeconfig();
      if (session === pickerSession.current && selected !== null) setPath(selected);
    } catch {
      if (session === pickerSession.current) setPickerError(filePickerError);
    } finally {
      if (session === pickerSession.current) {
        pickerPending.current = false;
        setPicking(false);
      }
    }
  }
  function close() {
    if (!busy) {
      invalidatePicker();
      setOpen(false);
      setPath("");
    }
  }
  async function submit() {
    if (pickerPending.current) return;
    const saved = await run("catalog_import_kubeconfig", { path });
    if (saved) {
      setOpen(false);
      setPath("");
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
            onClick={open}
          />
      </HStack>
      <Dialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        purpose={busy ? "required" : "form"}
      >
        <Layout
          header={
            <DialogHeader
              title="Import kubeconfig"
              onOpenChange={busy ? undefined : () => close()}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={4}>
                <Text as="p">
                  Import context metadata.
                  Credentials stay out of the catalog. No connections or
                  authentication commands will run.
                </Text>
                <TextInput
                  label="Kubeconfig path"
                  value={path}
                  onChange={setPath}
                  isRequired
                  isDisabled={busy || picking}
                  autoComplete="off"
                />
                <Button
                  label="Choose File"
                  icon={<Icon icon={IconFolder} />}
                  isDisabled={busy || picking || !available}
                  isLoading={picking}
                  onClick={() => void chooseFile()}
                />
                {pickerError && <Text role="alert">{pickerError}</Text>}

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
                  label={busy ? "Saving…" : "Import contexts"}
                  isDisabled={busy || picking || !path.trim()}
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
