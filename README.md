# Genesis

A touch-first arcade game built for **Safari on iPhone**. You're a newborn star:
absorb motes smaller than you, avoid the ones that are bigger, and grow until you
fill the goal ring to clear the stage.

No frameworks, no build step. It's plain HTML, CSS, and JavaScript on a `<canvas>`.

## How to play

- **Drag anywhere** to steer. Movement is relative, so your finger never covers your star.
- **Blue/green motes** are smaller than you. Absorb them to grow. Greener means closer to your size.
- **Red motes** are bigger than you. Touching one ends the run.
- **Magenta hunters** (stage 3+) are big motes that chase you.
- **Gold motes** trigger a 5-second **nova**: you can absorb anything, and hunters flee.
- Absorb quickly in a row to build a **combo multiplier** (up to x4).
- Fill the dashed goal ring to clear the stage. Each stage is faster and more dangerous.

## iOS Safari specifics

- `viewport-fit=cover` plus `env(safe-area-inset-*)` keeps the HUD clear of the notch and Dynamic Island.
- Pinch-zoom, double-tap zoom, rubber-band scrolling, text selection, and the long-press callout are all disabled.
- Audio uses Web Audio synthesis and unlocks on the first tap, as iOS requires. It resumes after interruptions.
- The game pauses automatically when you switch apps, lock the phone, or change tabs.
- Canvas resolution follows `devicePixelRatio`, capped at 2x for steady frame rates. The game adapts to Safari's toolbar showing and hiding.
- **Add to Home Screen** runs it full-screen with an app icon, and the service worker lets it work offline.
- High score is saved in `localStorage`. This fails gracefully in Private Browsing.

## Run locally

Serve the folder with any static server, then open it on your phone over the same Wi-Fi:

```sh
npx http-server -p 8080 .
# then visit http://<your-computer-ip>:8080 in Safari on iPhone
```

It also works on desktop browsers with a mouse. Press `Esc`/`P` to pause and `Space` to start.

## Deploy

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`.
To turn it on, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
