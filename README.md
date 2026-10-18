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

Deploy the updated sync service **before** publishing app version 2.4: the app requires its `/recommend` endpoint. The backend remains compatible with older apps' `/sync` requests. Merging app changes to main publishes GitHub Pages and triggers a michaelrad.me rebuild, as described in `CLAUDE.md`.
