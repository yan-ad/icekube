import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { destinations } from "../navigation";

export function AppSearch({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const searchSource = useMemo(() => createStaticSource(destinations.map((destination) => ({
    id: destination.path,
    label: destination.label,
    auxiliaryData: { group: "Pages", description: destination.description },
  }))), []);

  return (
    <CommandPalette
      label="Search Icekube"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      searchSource={searchSource}
      emptySearchText="No matching pages. Try Welcome, Catalog, or Clusters."
      onValueChange={(value) => {
        const destination = destinations.find((item) => item.path === value);
        if (destination) {
          onOpenChange(false);
          void navigate({ to: destination.path });
        }
      }}
    />
  );
}
