import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  const [throttle, setThrottle] = useState<RefetchThrottle | null>(null);

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
    setThrottle(t);

    const track = (p: Promise<UnlistenFn>) =>
      p.then((u) => {
        if (disposed) u();
        else unlistens.push(u);
      }, () => undefined);

    void track(onActivitySignal(connectionId, () => t.request()));
    void track(
      onConnectionState(connectionId, (isConnected) => {
        connected = isConnected;
        if (isConnected) t.request();
        else {
          seq++;
          setState(nextStateOnFetch({ ok: false }, false));
        }
      }),
    );
    t.request();

    return () => {
      disposed = true;
      t.dispose();
      unlistens.forEach((u) => u());
    };
  }, [connectionId]);

  const value = useMemo<ActivityContextValue>(
    () => ({ state, refresh: () => throttle?.request() }),
    [state, throttle],
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
