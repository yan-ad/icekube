import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type RefreshAction = { clusterId: string; section: string; enabled: boolean; refresh: () => void };
type Registration = RefreshAction & { owner: symbol };
const Context = createContext<{ action: RefreshAction | null; register: (action: RefreshAction) => () => void } | null>(null);

export function WorkspaceRefreshProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<Registration | null>(null);
  const register = useCallback((next: RefreshAction) => {
    const owner = Symbol();
    setAction({ ...next, owner });
    return () => setAction((previous) => previous?.owner === owner ? null : previous);
  }, []);
  return <Context value={{ action, register }}>{children}</Context>;
}
export function useWorkspaceRefresh() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkspaceRefreshProvider is required");
  return context;
}
export function useRegisterWorkspaceRefresh(action: RefreshAction, active = true) {
  const { register } = useWorkspaceRefresh();
  const callback = useRef(action.refresh);
  callback.current = action.refresh;
  useEffect(() => active ? register({ ...action, refresh: () => callback.current() }) : undefined, [register, action.clusterId, action.section, action.enabled, active]);
}
