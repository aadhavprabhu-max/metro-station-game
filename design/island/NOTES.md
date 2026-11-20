# Island HUD — notes (context for Claude Code / future sessions)

**Project:** Aurealis-Bahn is my fictional European railway operator, with a first-person 3D game in the repo `aadhavprabhu-max/metro-station-game`. The HUD is being redesigned to be minimalist, small and Apple-like.

**Done so far (in Claude chat, 20 Nov 2026):**
- Built the **Island HUD** prototype: a top-centre, true-black (#000000) morphing pill inspired by the Dynamic Island concept, using original icons and no Apple assets.
  - **States:** idle (126×37), compact (250×37: line badge, ETA, progress ring), split (196×37 plus a separate doors bubble with a metaball "liquid" bridge), expanded (376×178), alert (352×76), quick actions (352×164).
  - **Expanded layout:** follows Apple's Leading / Center / Trailing / Bottom zones. A faint black camera-pill area is reserved at the top centre. Leading holds the train tile, Trailing the ETA and platform, Center "Next: X" plus line and destination, and Bottom the stop track and the status/doors line.
  - **Motion:** frame-by-frame springs (k 235, c 21.5; the bubble's gap uses a softer spring) that keep their velocity when the target changes mid-animation. Content layers crossfade with a blur, timed by a CSS `linear()` spring curve.
  - **Corners:** continuous iOS-style corners on the island only, built from the reverse-engineered UIKit geometry by PaintCode. Each corner is 3 cubic curves, the curve starts 1.52866483 × r from the corner, and r is capped at min(w,h)/2/1.528. Near full radius the shape blends 70% toward a true capsule end (`CAPSULE_BLEND`). Everything else uses plain CSS `border-radius`. The expanded radius is 36 (about 1/5 of the height).
  - **Hide/show:** the island can be hidden, and the bottom glass HUD (speed, line, next stop and ETA) takes over while it's hidden. Alerts are suppressed while hidden unless `alertsWhenHidden` is set.
- **Code review pass:** 14 real bugs fixed and re-tested in a headless browser:
  - the island now works when copied on its own
  - keyboard activation of the inner buttons works
  - alerts during the doors split return to the split
  - a delay holds the train instead of moving it backwards
  - Esc is only consumed while the island is open
  - left button only for long-press
  - the long-press flag resets
  - hidden layers are `inert`
  - split always comes with doors
  - `setState('alert')` is blocked
  - text is bound with `textContent` only
  - door timers are cancelled correctly
  - delay is kept during a station stop
  - the pulse animation and the scale no longer clash
- **Teaser video:** `aurealis-island-coming-soon.mp4` (21 s, 1080p30, black, 120 BPM, original synth track). It was rendered **before** the zone layout and corner changes, so it's outdated.

**Decisions:**
- The colour must be true black #000000.
- Fast-paced, all-black, Apple-style for promo material.
- Nitpicks were deliberately skipped: contrast on the purple line colour, reduced-motion support, nested-button ARIA roles, aria-live for alerts, ETA rounding at 89/90 s.
- The game sim (trains, schedules, stations, stops, physics) must not change.

**In-game integration (done):**
- Code: `src/ui/island/island.css` and `island.js` hold the prototype's CSS, markup and script. The only change to the CSS is that every selector is scoped under `.island`. `src/ui/island/islandAdapter.js` is the read-only game → island bridge. It is mounted from `src/ui.js`, in glass mode only (`?ui=legacy` has no island).
- Two fixes to the ported script: (1) the spring step clamps `dt` at 0. Inside heavy WebGL frames the rAF timestamp can come before the `performance.now()` taken in `setTargets()`, so the springs integrated backwards and diverged (the pill grew to millions of px). (2) The mount takes a container instead of looking up `#island` at load.
- Data: the followed service, the same one the glass pill shows (`ui.liveService()` + `passengerInformation.describe()`). At a platform the track shows the leg just completed (prev → this station → next, progress 1, ETA “Now”). Progress is distance-based and clamped per leg so it can only go forward. `delayMin` is always 0 because the game has no delay model.
- Events: ~36 s out → “Arriving at X” (once per leg). `boarding` → `doors('open')`, `closing` → `doors('closing')`, otherwise `doors(null)`. A red-signal hold (`waitingForSignal` for more than 1 s) → “Held at signal” warn alert.
- Keys: **I** hides / shows the island. **O**: tap expands / collapses, a 460 ms hold opens quick actions (focus lands on Doors, and Enter / Space activate). The game has no pointer lock (drag to look), so the mouse always works. Esc closes the island only while it is open; otherwise it reaches the glass menu as before.
- Quick actions never touch the simulation. Map opens the glass menu's network map. Announce shows the current onboard caption, or the next-stop line. Horn shows “not available” (the game has no horn). Doors shows the live door status (read-only; departures are not triggered).
- Swap: island visible → `#gh-service-pill.gh-pill-gone` (fade + slide). The choice persists in `localStorage['aurealis-island-hidden']`. While exploring the street or driving, the island steps aside via CSS only.
- Known: on narrow phones (≤560 px) the island can overlap the top-right clock and menu button.

**Open / next:**
1. Move the alert and quick-actions layouts into the Leading / Center / Trailing zones too, since they still cross the camera-pill area.
2. Re-render the teaser video with the new expanded layout and corners. Maybe also a 9:16 cut.
3. Optional later: the skipped nitpicks above.
4. Narrow-screen layout for the island next to the top-right clock and menu.

**Artifacts:** the live prototype is "Aurealis-Bahn · Island HUD" (Claude artifact). The source file is `aurealis-island.html`, and the video is `aurealis-island-coming-soon.mp4`.
