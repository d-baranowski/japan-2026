"""Original 8-bit sound effects for videos, synthesised here (no samples from any game).

  python make_sfx.py   -> pipe-pop.wav

pipe-pop.wav, for VID_20261006_202711 (climbing out of the pipe at Narita): a stuttering square-wave
rise while the head and shoulders come up (0-0.7 s), then a power-up arpeggio as the fist goes up.
export_media.py mixes it over the video's own sound (see "sfx" in data.json).
"""
import math, os, struct, wave

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))


def render(length, voices):
    out = [0.0] * int(SR * length)
    for t0, dur, freq, vol, duty, gate, vib in voices:
        n0, n, ph = int(t0 * SR), int(dur * SR), 0.0
        for i in range(n):
            t = i / SR
            f = freq(t / dur) * (1 + vib * math.sin(2 * math.pi * 7 * t))
            ph += f / SR
            s = 1.0 if ph % 1.0 < duty else -1.0
            env = min(1.0, i / (0.004 * SR), (n - i) / (0.02 * SR))
            if gate and (t * gate) % 1.0 > 0.6:
                env = 0.0
            out[n0 + i] += s * vol * env
    return out


def save(name, samples):
    with wave.open(os.path.join(HERE, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))


# rise: 160 Hz -> ~740 Hz, gated 28 times a second, 25 % pulse
rise = [(0.02, 0.70, lambda x: 160 * 2 ** (x * 2.2), 0.20, 0.25, 28, 0)]
# power-up: quick major arpeggio, then a held top note with vibrato that fades
notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
arp = [(0.72 + k * 0.06, 0.06, (lambda f: lambda x: f)(f), 0.17, 0.5, 0, 0) for k, f in enumerate(notes)]
hold = [(0.72 + len(notes) * 0.06, 0.45, lambda x: 1568.0, 0.14, 0.5, 0, 0.012)]
pipe = render(1.6, rise + arp + hold)
# fade the held note out over its length
start = int((0.72 + len(notes) * 0.06) * SR)
for i in range(start, len(pipe)):
    pipe[i] *= max(0.0, 1 - (i - start) / (0.45 * SR)) ** 1.5
save('pipe-pop.wav', pipe)
print('pipe-pop.wav', len(pipe) / SR, 's')
