import { useEffect, useRef, useState } from "react";
import { trackCta } from "../lib/funnel";
import { HOME_VIDEO } from "../seo/homeContent";
import { PlayIcon } from "./icons";
import styles from "./HomeVideo.module.css";

// Home's how-to-play video, click to play. Until the tap it is a facade: the
// video's own YouTube thumbnail under a play button, so Home loads no YouTube
// script, iframe or cookie, and the prerendered HTML (what crawlers and link
// previews read) carries the poster. The tap swaps in YouTube's embed, which
// starts playing because the visitor asked for it and the player is on screen.
//
// YouTube's embed rules (see YouTubePlayer.module.css and PR #401): the player
// is at least 200 x 200 px (the frame is never narrower than 200 px, and 9:16
// makes it taller than wide), and nothing of ours is drawn over it: the
// caption sits under the frame, and the play button goes away with the facade.
// The facade is the same on the server and in the browser (`playing` starts
// false on both), so hydration keeps the prerendered markup.
export function HomeVideo() {
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);

  // The button that had focus is gone; hand focus to the player in its place,
  // so a keyboard user stays where they were in the page.
  useEffect(() => {
    if (playing) player.current?.focus({ preventScroll: true });
  }, [playing]);

  return (
    <figure className={styles.video}>
      <div className={styles.frame}>
        {playing ? (
          <iframe
            ref={player}
            className={styles.player}
            src={HOME_VIDEO.embed}
            title={`${HOME_VIDEO.title} (video)`}
            // YouTube's own embed code: full screen through allowFullScreen
            // (naming it in `allow` too makes Chrome warn).
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            className={styles.facade}
            aria-label={HOME_VIDEO.label}
            onClick={() => {
              trackCta("home_video_play");
              setPlaying(true);
            }}
          >
            <img
              className={styles.poster}
              src={HOME_VIDEO.thumbnail}
              alt=""
              width={HOME_VIDEO.thumbnailWidth}
              height={HOME_VIDEO.thumbnailHeight}
              loading="lazy"
              decoding="async"
            />
            <span className={styles.play} aria-hidden="true">
              <PlayIcon />
            </span>
          </button>
        )}
      </div>
      <figcaption className={styles.caption}>{HOME_VIDEO.caption}</figcaption>
    </figure>
  );
}
