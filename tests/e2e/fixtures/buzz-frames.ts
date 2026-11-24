import { type Page } from "@playwright/test";

type Source = "broadcast" | "changes";
type RawFrame = string | Buffer;

export interface LockFrame {
  source: Source;
  revision: number;
  team: string;
  received: number;
  deliver: () => void;
}

function parse(raw: RawFrame) {
  if (typeof raw === "string") {
    const msg = JSON.parse(raw);
    return Array.isArray(msg) ? { event: msg[3], payload: msg[4] } : msg;
  }
  // Phoenix v2 binary JSON Broadcast header: kind, topic/event/metadata sizes, encoding.
  if (raw[0] !== 4 || raw[4] !== 1) return null;
  const eventStart = 5 + raw[1]!;
  const eventEnd = eventStart + raw[2]!;
  const event = raw.toString("utf8", eventStart, eventEnd);
  const payload = JSON.parse(raw.toString("utf8", eventEnd + raw[3]!));
  return { event: "broadcast", payload: { event, payload } };
}

export async function routeBuzzFrames(
  page: Page,
  onLock: (frame: LockFrame) => void,
  dropTeamJoins = false,
): Promise<void> {
  await page.routeWebSocket(/\/realtime\//, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const received = performance.now();
      const msg = parse(raw);
      if (msg?.event === "broadcast" && msg.payload?.event === "buzz_locked") {
        const lock = msg.payload.payload;
        onLock({
          source: "broadcast",
          revision: lock.buzz_revision,
          team: lock.buzzed_team_id,
          received,
          deliver: () => socket.send(raw),
        });
        return;
      }
      const change =
        msg?.event === "postgres_changes" ? msg.payload?.data : null;
      if (
        dropTeamJoins &&
        change?.table === "game_teams" &&
        change.type === "INSERT"
      )
        return;
      if (
        change?.table === "active_games" &&
        change.type === "UPDATE" &&
        change.record?.buzzed_team_id != null &&
        change.old_record?.buzzed_team_id == null
      ) {
        onLock({
          source: "changes",
          revision: change.record.buzz_revision,
          team: change.record.buzzed_team_id,
          received,
          deliver: () => socket.send(raw),
        });
        return;
      }
      socket.send(raw);
    });
  });
}

export async function stubYouTube(page: Page): Promise<void> {
  await page.route("https://www.youtube-nocookie.com/embed/**", (route) =>
    route.fulfill(),
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      YT: {
        Player: class {
          constructor(
            _element: HTMLElement,
            {
              events,
            }: {
              events?: {
                onReady?: () => void;
                onStateChange?: (event: { data: number }) => void;
              };
            },
          ) {
            queueMicrotask(() => events?.onReady?.());
          }
          loadVideoById() {}
          cueVideoById() {}
          mute() {}
          unMute() {}
          seekTo() {}
          getCurrentTime() {
            return 0;
          }
          getDuration() {
            return 180;
          }
          getVideoLoadedFraction() {
            return 1;
          }
          pauseVideo() {}
          playVideo() {}
          stopVideo() {}
          getPlayerState() {
            return 1;
          }
          destroy() {}
        },
      },
    });
  });
}
