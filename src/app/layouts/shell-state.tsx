import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PIN_STORAGE_KEY, parsePinnedPages, type PinnablePath } from "../navigation";

type ShellState = {
  pinnedPages: PinnablePath[];
  togglePin: (path: PinnablePath) => void;
  storageWarning: boolean;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellStateProvider({ children }: { children: ReactNode }) {
  const [pinnedPages, setPinnedPages] = useState<PinnablePath[]>(() => {
    try {
      return parsePinnedPages(localStorage.getItem(PIN_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const [storageWarning, setStorageWarning] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedPages));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [pinnedPages]);

  useEffect(() => {
    function syncPins(event: StorageEvent) {
      if (event.key === PIN_STORAGE_KEY || event.key === null) {
        setPinnedPages(parsePinnedPages(event.newValue));
      }
    }
    window.addEventListener("storage", syncPins);
    return () => window.removeEventListener("storage", syncPins);
  }, []);

  function togglePin(path: PinnablePath) {
    setPinnedPages((pages) => pages.includes(path) ? pages.filter((page) => page !== path) : [...pages, path]);
  }

  return (
    <ShellContext value={{ pinnedPages, togglePin, storageWarning }}>
      {children}
    </ShellContext>
  );
}

export function useShellState() {
  const state = useContext(ShellContext);
  if (!state) throw new Error("Shell state must be used inside ShellStateProvider");
  return state;
}
