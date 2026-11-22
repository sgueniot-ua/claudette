import { useState, type ReactNode } from "react";
import { ActivityProvider } from "./services/useActivity";
import { ChatListScreen } from "./screens/ChatListScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ConnectScreen } from "./screens/ConnectScreen";
import { WorkspacesScreen } from "./screens/WorkspacesScreen";
import type { ChatSession, SavedConnection, Workspace } from "./types";

type View =
  | { kind: "connect" }
  | { kind: "workspaces"; connection: SavedConnection }
  | {
      kind: "chat-list";
      connection: SavedConnection;
      workspace: Workspace;
    }
  | {
      kind: "chat";
      connection: SavedConnection;
      workspace: Workspace;
      session: ChatSession;
    };

// Top-level navigation: connect → workspaces → chat list → chat. The
// chat view (streaming, composer, AskUserQuestion sheet, plan approval
// card) routes through `ChatScreen` below.

function withActivity(connectionId: string, children: ReactNode) {
  return (
    <ActivityProvider key={connectionId} connectionId={connectionId}>
      {children}
    </ActivityProvider>
  );
}

export function App() {
  const [view, setView] = useState<View>({ kind: "connect" });

  switch (view.kind) {
    case "connect":
      return (
        <ConnectScreen
          onConnected={(connection) =>
            setView({ kind: "workspaces", connection })
          }
        />
      );
    case "workspaces":
      return withActivity(
        view.connection.id,
        <WorkspacesScreen
          connection={view.connection}
          onOpenWorkspace={(workspace) =>
            setView({
              kind: "chat-list",
              connection: view.connection,
              workspace,
            })
          }
          onDisconnect={() => setView({ kind: "connect" })}
        />
      );
    case "chat-list":
      return withActivity(
        view.connection.id,
        <ChatListScreen
          connection={view.connection}
          workspace={view.workspace}
          onOpenSession={(session) =>
            setView({
              kind: "chat",
              connection: view.connection,
              workspace: view.workspace,
              session,
            })
          }
          onBack={() =>
            setView({ kind: "workspaces", connection: view.connection })
          }
        />
      );
    case "chat":
      return withActivity(
        view.connection.id,
        <ChatScreen
          connection={view.connection}
          workspace={view.workspace}
          session={view.session}
          onBack={() =>
            setView({
              kind: "chat-list",
              connection: view.connection,
              workspace: view.workspace,
            })
          }
        />
      );
  }
}
