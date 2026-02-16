# Car Racer (iPhone)

A clean, mobile‑first, 60fps **Canvas** endless runner with **3 lanes**.

- Pure **HTML/CSS/JS** (no frameworks)
- Touch controls: **on‑screen ◀ ▶** + **optional swipe**
- Auto‑accelerate + difficulty ramp
- Pause / restart / simple menu
- No external assets (everything is drawn)
- Optional **SFX toggle** (simple WebAudio beeps)

## Play

- Open `index.html` locally, or deploy to GitHub Pages.
- Best played on iPhone in Safari. Tip: **Share → Add to Home Screen**.

## Controls

- Tap **◀** / **▶** to change lanes
- Swipe left/right anywhere on the game to change lanes
- Auto‑accelerate (no throttle)
- Pause button in the top right

Keyboard (desktop testing):
- Arrow keys: move
- `P`: pause/resume
- `R`: restart

## Project structure

- `index.html` – UI + canvas
- `style.css` – mobile‑first layout
- `game.js` – game loop, physics, drawing, input

## Manual QA / sanity checklist

On an iPhone (portrait + landscape):
- [ ] Start game from menu
- [ ] Tap ◀ ▶ changes lanes reliably (no page scroll/zoom)
- [ ] Swipe left/right changes lanes
- [ ] Score increases over time
- [ ] Difficulty ramps (speed/spawn frequency increases)
- [ ] Collision triggers Game Over overlay
- [ ] Best score persists after refresh
- [ ] Pause stops gameplay; Resume continues without a big jump
- [ ] Restart works from Pause and Game Over
- [ ] SFX toggle disables/enables sounds

## Notes

This is intentionally asset‑free and framework‑free so it can run as a static site on GitHub Pages.
