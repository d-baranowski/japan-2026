"""Export the photos/videos that data.json uses into the deck, and compute chart data.

Usage (needs Pillow and ffmpeg):  python export_media.py <photos_dir> [<deck_dir>]
  photos_dir  the original photos and videos, e.g. ~/Downloads/Do pok
  deck_dir    where photos/ and videos/ go (default: the folder above _build)
Reads data.json, private/indexed.json and private/gps.json; writes media.json.
Media already in deck_dir is kept as is, so a re-run only encodes new items
(delete a video's .mp4 to re-cut it after changing its ss/t).
Photos are re-encoded without EXIF (no GPS leaves the machine in the deck).
"""
import json, os, subprocess, sys
from collections import Counter
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..')
data = json.load(open(os.path.join(HERE, 'data.json')))
idx = json.load(open(os.path.join(HERE, 'private', 'indexed.json')))
gps = json.load(open(os.path.join(HERE, 'private', 'gps.json')))

os.makedirs(f'{OUT}/photos/full', exist_ok=True)
os.makedirs(f'{OUT}/photos/thumb', exist_ok=True)
os.makedirs(f'{OUT}/videos', exist_ok=True)

used = []
for ch in data['chapters']:
    for it in ch['items']:
        if 'p' in it:
            used += it['p'] if isinstance(it['p'], list) else [it['p']]
used = sorted(set(used))

media = {}
for i in used:
    rec = idx[i]
    full_p, th_p = f'{OUT}/photos/full/p{i:03d}.jpg', f'{OUT}/photos/thumb/p{i:03d}.jpg'
    if os.path.exists(full_p) and os.path.exists(th_p):
        with Image.open(full_p) as full:
            media[i] = {'w': full.width, 'h': full.height, 'dt': rec.get('dt')}
        continue
    src = os.path.join(SRC, rec['f'])
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    w, h = im.size
    full = im.copy(); full.thumbnail((1800, 1800), Image.LANCZOS)
    full.save(full_p, quality=82, optimize=True, progressive=True)
    th = im.copy(); th.thumbnail((520, 520), Image.LANCZOS)
    th.save(th_p, quality=72, optimize=True)
    media[i] = {'w': full.width, 'h': full.height, 'dt': rec.get('dt')}

videos = {}
for ch in data['chapters']:
    for it in ch['items']:
        if 'v' not in it:
            continue
        v = it['v']
        src = os.path.join(SRC, v + '.mp4')
        out = f'{OUT}/videos/{v}.mp4'
        if not (os.path.exists(out) and os.path.exists(f'{OUT}/videos/{v}.jpg')):
            # whole video, scaled to 720p; optional "ss"/"t" in data.json trim it
            trim = (['-ss', str(it['ss'])] if 'ss' in it else []) + (['-t', str(it['t'])] if 't' in it else [])
            scale = "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'"
            if 'sfx' in it:   # a sound effect (path relative to _build) mixed over the video's own sound
                filt = ['-i', os.path.join(HERE, it['sfx']), '-filter_complex',
                        f"[0:v]{scale}[v];[1:a]volume={it.get('sfxVol', 0.8)}[s];[0:a][s]amix=inputs=2:duration=first:normalize=0[a]",
                        '-map', '[v]', '-map', '[a]']
            else:
                filt = ['-vf', scale]
            subprocess.run(['ffmpeg', '-v', 'error', '-y', *trim, '-i', src, *filt,
                            '-map_metadata', '-1',
                            '-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], check=True)
            # still shown before it plays: the frame at "poster" seconds
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(it.get('poster', 0.3)), '-i', out, '-frames:v', '1',
                            '-q:v', '4', f'{OUT}/videos/{v}.jpg'], check=True)
        probe = subprocess.run(['ffprobe', '-v', 'quiet', '-select_streams', 'v:0', '-show_entries',
                                'stream=width,height', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout
        vw, vh = [int(x) for x in probe.strip().split(',')[:2]]
        # stamp date from filename VID_YYYYMMDD_HHMMSS
        stamp = v.split('_')[1]
        videos[v] = {'w': vw, 'h': vh, 'dt': f'{stamp[:4]}:{stamp[4:6]}:{stamp[6:8]} {v.split("_")[2][:2]}:{v.split("_")[2][2:4]}:00'}

# --- chart data -------------------------------------------------------------
BAD = {(36.0102, 138.1749), (35.7297, 137.9538), (35.46, 138.6942)}  # stale GPS fixes
fixes = []
for g in gps:
    key = (round(g['lat'], 4), round(g['lon'], 4))
    if not g.get('alt') or g['alt'] <= 0 or key in BAD or (g['lat'] == 0 and g['lon'] == 0):
        continue
    fixes.append({'i': g['i'], 'dt': g['dt'], 'lat': round(g['lat'], 5), 'lon': round(g['lon'], 5), 'alt': round(g['alt'])})

per_day = Counter((r.get('dt') or '')[:10] for r in idx if r.get('dt'))
json.dump({'media': media, 'videos': videos, 'fixes': fixes, 'perDay': per_day},
          open(os.path.join(HERE, 'media.json'), 'w'), indent=0)
print(len(used), 'photos;', len(videos), 'videos;', len(fixes), 'gps fixes')
print(sorted(per_day.items()))
