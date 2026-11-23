import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  nextStateOnFetch,
  RefetchThrottle,
  type ActivityState,
} from "./activity";
import { onActivitySignal, onConnectionState } from "./events";
import { getWorkspacesActivity } from "./rpc";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface ActivityContextValue {
  state: ActivityState;
  refresh: () => void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider(props: {
  connectionId: string;
  children: ReactNode;
}) {
  const { connectionId, children } = props;
  const [state, setState] = useState<ActivityState>({ kind: "loading" });
  const throttleRef = useRef<RefetchThrottle | null>(null);

  useEffect(() => {
    let disposed = false;
    let connected = true;
    let seq = 0;
    const unlistens: UnlistenFn[] = [];

    // Errors never reach the UI as a banner: they only decide the state.
    const fetchActivity = async () => {
      const mine = ++seq;
      let next: ActivityState;
      try {
        const data = await getWorkspacesActivity(connectionId);
        next = nextStateOnFetch({ ok: true, data }, connected);
      } catch {
        next = nextStateOnFetch({ ok: false }, connected);
      }
      if (!disposed && mine === seq) setState(next);
    };

    const t = new RefetchThrottle(() => void fetchActivity(), 300);
    throttleRef.current = t;
    const request = () => {
      if (!disposed) t.request();
    };

    const track = (p: Promise<UnlistenFn>) =>
      p.then((u) => {
        if (disposed) u();
        else unlistens.push(u);
      }, () => undefined);

    void track(onActivitySignal(connectionId, request));
    void track(
      onConnectionState(connectionId, (isConnected) => {
        if (disposed) return;
        connected = isConnected;
        if (isConnected) request();
        else {
          seq++;
          setState(nextStateOnFetch({ ok: false }, false));
        }
      }),
    );
    // Also serves a refresh() asked before this effect ran (children's effects
    // run first, while throttleRef is still null): it is not lost.
    request();

    return () => {
      disposed = true;
      throttleRef.current = null;
      t.dispose();
      unlistens.forEach((u) => u());
    };
  }, [connectionId]);

  const refresh = useCallback(() => throttleRef.current?.request(), []);
  const value = useMemo<ActivityContextValue>(
    () => ({ state, refresh }),
    [state, refresh],
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used inside ActivityProvider");
  return ctx;
}
