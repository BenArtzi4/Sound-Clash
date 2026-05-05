import { useCallback, useState } from "react";

interface PendingSong {
  youtube_id: string;
  start_time: number;
}

export function usePlayerReady(): {
  ready: boolean;
  setReady: () => void;
  pendingSong: PendingSong | null;
  enqueueSong: (song: PendingSong) => void;
  flushPendingSong: () => PendingSong | null;
} {
  const [ready, setReadyState] = useState(false);
  const [pendingSong, setPendingSong] = useState<PendingSong | null>(null);

  const setReady = useCallback(() => {
    setReadyState(true);
  }, []);

  const enqueueSong = useCallback(
    (song: PendingSong) => {
      if (!ready) {
        setPendingSong(song);
      }
    },
    [ready],
  );

  const flushPendingSong = useCallback(() => {
    const song = pendingSong;
    setPendingSong(null);
    return song;
  }, [pendingSong]);

  return { ready, setReady, pendingSong, enqueueSong, flushPendingSong };
}
