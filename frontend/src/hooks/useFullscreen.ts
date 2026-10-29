import { useCallback, useEffect, useState } from "react";

// Full screen for the display page. A phone mirrored to a TV otherwise sends
// its status bar and browser toolbar to the TV too, and they take a fifth of a
// landscape phone's height. `supported` is false where the page can't go full
// screen (iPhone Safari only allows it for video), so the caller renders no
// button there.
export function useFullscreen(): { supported: boolean; active: boolean; enter: () => void } {
  const supported =
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function";
  const [active, setActive] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement != null,
  );

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(() => {
    void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  }, []);

  return { supported, active, enter };
}
