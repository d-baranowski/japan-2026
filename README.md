# Japan 2026

Our trip around Japan, 5 Oct – 1 Nov 2026, as an [impress.js](https://github.com/impress/impress.js) deck.

**Open it:** https://d-baranowski.github.io/japan-2026/

Keys: `←` / `→` (or space) to move, `o` for the whole route, `h` to hide the HUD, `F11` / `⌃⌘F` for full screen.

## Rebuild

```sh
cd _build
pnpm install
node build.mjs ..
```

Captions and chapters are in `_build/data.json`. Map, layout and charts are in `_build/build.mjs`.
The map is drawn into `<canvas>` images by the script in `_build/template.html`.

### Adding photos and videos

The originals stay outside the repo (`~/Downloads/Do pok`); `_build/private/indexed.json` (local only)
numbers them.

1. Add an item to a chapter in `_build/data.json`: `{"p": 123, "cap": "…", "place": "…"}`, `"p": [a, b]`
   for two side by side, or `{"v": "VID_…", "poster": 12.3, "cap": "…", "place": "…"}` for a video
   (used whole; `poster` is the second shown before it plays; `"sfx": "sfx/….wav"` mixes a sound over
   it, see `_build/sfx/make_sfx.py`).
2. `uv run --with pillow python export_media.py ~/Downloads/"Do pok"` (needs ffmpeg): encodes only what isn't in
   `photos/` or `videos/` yet, without EXIF.
3. `node build.mjs ..`

Bike days: `node bike.mjs` routes each day between the photo locations and samples terrain heights
(needs network; writes `bike.json`, which is committed, so the normal build stays offline).

## Performance check

```sh
cd _build/perf
node run.mjs mylabel        # walks every slide in real Chrome, records frames, blank tiles, GPU memory
node summary.cjs mylabel 10
```
