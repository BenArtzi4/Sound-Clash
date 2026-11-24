# Host playback recovery

1. Reproduce blocked autoplay after a preview miss on Start or Next. The round commits, but the existing controls stay disabled until the first playback event.
2. Use the existing transport to offer Play song on a browser block and Retry playback on a load failure or stall. Reload the current video from its cue in the tap and preserve the preview-ready fast path.
3. Reject stale video events and repeated retry taps. Keep recovery paused while a team holds the floor and keep Next round available for an embed that keeps failing.
4. Verify the frontend suite, lint, types and build. Inject a late or missing preview in a mobile browser and confirm recovery sends zero round-advance requests. Play ten rounds with four teams and a display, check simultaneous direct-RPC buzzes and scoring, then repeat gameplay on production after deployment.
