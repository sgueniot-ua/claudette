import { useEffect } from "react";
import {
  listenAdbDevicesChanged,
  listenAdbLogcatLines,
  listenAdbSessionStatus,
} from "../../services/adb";
import { useAppStore } from "../../stores/useAppStore";
import { adbLogBuffer } from "./adbLogBuffer";

// Subscribes once to the ADB events: log lines feed the out-of-store buffer
// (version bumps are throttled to one per animation frame per workspace),
// session status and device list feed the store.
export function useAdbEvents(): void {
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const pending = new Map<string, number>();

    const track = (promise: Promise<() => void>) => {
      promise
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((e) => console.error("ADB event subscription failed:", e));
    };

    track(
      listenAdbLogcatLines(({ workspace_id, lines, reset }) => {
        adbLogBuffer.append(workspace_id, lines, reset);
        if (pending.has(workspace_id)) {
          return;
        }
        pending.set(
          workspace_id,
          requestAnimationFrame(() => {
            pending.delete(workspace_id);
            useAppStore.getState().bumpAdbLogVersion(workspace_id);
          }),
        );
      }),
    );
    track(
      listenAdbSessionStatus(({ workspace_id, status }) =>
        useAppStore.getState().setAdbSessionStatus(workspace_id, status),
      ),
    );
    track(
      listenAdbDevicesChanged(({ devices }) =>
        useAppStore.getState().setAdbDevices(devices),
      ),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      pending.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, []);
}
