# Rad Mobility

A daily regular-mobility and evening wind-down routine at https://michaelrad.me/mobility/.

## Video rotation (2.4)

There are 65 routines in each pool. Fresh videos are picked at random. A non-liked video can return only once 60 **distinct other IDs from that same pool** have been shown since its last appearance. A thumbs-up video can return after three days, with the existing 40% favorite preference. Deliberately choosing a favorite replays it immediately. Thumbs-down videos stay excluded.

Showing a card (including skipping it) counts toward rotation. Reloading selects a new eligible routine. Returning to an already-open app keeps the current card unless the time-of-day pool changes. Finishing an embedded video advances the queue. If nothing is eligible, the player is hidden rather than replaying an ineligible video.

Guests keep history on their device. Signed-in choices are reserved by `POST /recommend` in the companion [sync service](https://github.com/michaelrad100/rad-mobility-sync), which merges device history before selecting. If it cannot be reached, a signed-in device does not make an unsynced recommendation. Existing local `lastShown` and known completed IDs migrate; previously shown videos on devices whose local history is gone cannot be recovered.

## Refilling the library

With fewer than five unseen routines left for a signed-in account, the service records a durable aggregate request for that pool. The daily `Find fresh mobility videos` workflow checks `/content-needs`, searches public YouTube results (no new API key), excludes existing IDs, filters candidate durations to 5–16 minutes (allowing five seconds of rounding), and creates or updates one review issue. It can also be dispatched manually.

Candidates require review before inclusion. Search failures appear in the report with manual search links. A library change supersedes requests for the old catalog; the service can request more for the new catalog as users reach the threshold. Search candidates are never published straight into the video list. Avoid alternate music/nature-sounds uploads of a routine already in the library.

New entries and their source metadata are recorded in `docs/video-additions-2026-10-16.json`. Creator descriptions, duration, and embedding availability were checked; complete routines were not watched.

## Validation and rollout

Run `node --test tests/*.test.cjs`. Test the backend with `npm test` in the sync repository.

Version 2.5 fixes a player initialization race: if a signed-in recommendation arrives between YouTube player construction and its ready event, the ready handler now cues the current card. Player regression tests exercise both startup event orders, changes before readiness, guest startup, and an exhausted queue.

Version 2.6 makes the visible poster a real Play button instead of passing taps through to YouTube's underlying controls. It calls playback directly from the user gesture, shows loading/starting feedback, and reveals the native player if the browser blocks scripted playback. Its hidden state stops intercepting player controls after playback starts.

Version 2.7 adds a draggable video-position slider, elapsed/total time, a play/pause control, and single-tap areas on the left/right to rewind/advance ten seconds. These controls remain accessible above the tap shields while paused or near the end, in both card and full-screen layouts. Seeking preserves paused playback; rapid taps accumulate and clamp to the video's bounds. Controls become available when the routine starts, after the sound gate releases.

Version 2.8 adds **Finish routine ✓** during the last 30 seconds of an embedded video. It works while playing or paused, credits the routine through the same history/time/sync/badge path as normal completion, stops playback, and selects the next routine. Rewinding outside the last 30 seconds hides the button. YouTube-app mode continues to use its existing Finished? check-in on return.

Version 2.9 waits for both the YouTube API and a valid selected video before constructing the player. It avoids re-cueing the same video on readiness, preloads the API, and replaces an unready player when its card changes. If initialization stalls for ten seconds (or the script fails), it reveals native YouTube playback with Retry player and Open in YouTube options. Retrying keeps the selected recommendation; late callbacks from a replaced player are ignored. Native fallback playback uses YouTube's controls; **I’ve finished this routine** records completion credit when automatic tracking is unavailable. Opening YouTube externally uses the existing Finished? check-in.

Version 3.0 also stops the old progress timer when a playing video fails or the player is rebuilt, so it cannot poll a replacement before it is ready.

Version 3.1 restores direct native playback: the selected YouTube iframe loads immediately and its Play button is never covered by an app loading overlay. The API attaches to that same iframe in the background to add seeking, completion tracking and Finish routine. Attaching to an already playing video preserves playback and starts tracking without re-cueing it. The decorative poster is only used for the explicit YouTube-app handoff.

Deploy the updated sync service **before** publishing app version 2.4: the app requires its `/recommend` endpoint. The backend remains compatible with older apps' `/sync` requests. Merging app changes to main publishes GitHub Pages and triggers a michaelrad.me rebuild, as described in `CLAUDE.md`.
