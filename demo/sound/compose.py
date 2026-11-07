#!/usr/bin/env python3
"""Writes a film's soundtrack, synthesised from nothing, so an open-source repository has no music to license.

    python compose.py PROPS.json OUT_DIR

PROPS.json is what demo/render.sh saves for a film: its length, where each part of the arrangement starts (cues), and
which score it wants, each with its own takes. Neither score has interface sounds. Same input, same sound.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
random = np.random.default_rng(7)


def hz(note):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    return 440.0 * 2 ** ((names[note[:-1]] + 12 * (int(note[-1]) + 1) - 69) / 12)


def seconds(duration):
    return np.arange(int(duration * SR)) / SR


def lowpass(signal, cutoff, order=2):
    return sosfilt(butter(order, min(cutoff, SR / 2 - 100), fs=SR, output="sos"), signal)


def highpass(signal, cutoff, order=2):
    return sosfilt(butter(order, cutoff, btype="high", fs=SR, output="sos"), signal)


def bandpass(signal, low, high, order=2):
    return sosfilt(butter(order, [low, high], btype="band", fs=SR, output="sos"), signal)


class Mix:
    """A stereo buffer that sounds are placed into."""

    def __init__(self, length):
        self.left = np.zeros(int(length * SR))
        self.right = np.zeros(int(length * SR))

    def place(self, signal, at, gain=1.0, pan=0.0):
        start = int(max(0, at) * SR)
        if start >= len(self.left):
            return
        end = min(len(self.left), start + len(signal))
        left = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
        right = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
        self.left[start:end] += signal[: end - start] * gain * left
        self.right[start:end] += signal[: end - start] * gain * right

    def add(self, other, gain=1.0):
        self.left += other.left * gain
        self.right += other.right * gain

    def reverb(self, tail, wet, tone=4000):
        """A room made of decaying noise, a little different in each ear."""
        length = int(tail * SR)
        decay = np.exp(-6.9 * np.arange(length) / length)
        for side in ("left", "right"):
            room = lowpass(random.standard_normal(length) * decay, tone)
            room /= np.sqrt(np.sum(room**2))
            dry = getattr(self, side)
            setattr(self, side, dry + fftconvolve(dry, room)[: len(dry)] * wet)
        return self


def felt(freq, velocity=1.0, ring=2.6):
    """A felted piano note: a soft hammer, a few slightly sharp partials, the top dying first."""
    t = seconds(ring)
    note = np.zeros_like(t)
    for ratio, level, decay in [(1, 1.0, 1.0), (2.001, 0.42, 0.55), (3.004, 0.14, 0.32), (4.01, 0.06, 0.2), (6.03, 0.02, 0.1)]:
        note += level * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / (decay * ring * 0.45))
    note *= np.minimum(1, t / 0.006)
    hammer = lowpass(random.standard_normal(int(0.03 * SR)), 900) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR)) * 0.25
    note[: len(hammer)] += hammer
    return lowpass(note, 1400 + 2600 * velocity) * velocity * 0.32


def total_length(props):
    return props["seconds"] + props["opening"]["seconds"]


def hat(length=0.045, top=6800):
    t = seconds(length)
    return highpass(random.standard_normal(len(t)), top) * np.exp(-t / (length / 4.5))


def echoes(mix, beat):
    """A dotted-eighth echo that bounces between the ears."""
    delay = int(beat * 0.75 * SR)
    left, right = mix.left.copy(), mix.right.copy()
    for repeat in range(1, 5):
        gain = 0.42**repeat
        shift = delay * repeat
        source = right if repeat % 2 else left
        target = mix.left if repeat % 2 else mix.right
        target[shift:] += source[:-shift] * gain
    return mix


# The Ask film's score: one slow, unhurried piece in its own key that plays straight through. Nothing in it follows the
# picture, and it has no interface sounds, so the film's many screens never turn into many noises.
CHILL_TAKES = {
    "lofi": {"bpm": 72, "drums": True},
}
CHILL_CHORDS = [  # two bars each
    ("F2", ["A3", "C4", "E4", "G4"]),  # F major 9
    ("E2", ["G3", "B3", "D4", "A4"]),  # E minor 11
    ("D2", ["F3", "A3", "C4", "E4"]),  # D minor 9
    ("C2", ["E3", "G3", "B3", "D4"]),  # C major 9
]
TUNE = [(2, "A4"), (2.5, "C5"), (3.5, "E5"), (6, "D5"), (6.5, "C5"), (10, "B4"), (10.5, "G4"), (11.5, "D5"), (14, "B4"), (18, "A4"), (18.5, "C5"), (19.5, "F5"), (22, "E5"), (22.5, "C5"), (26, "G4"), (26.5, "B4"), (27.5, "D5"), (30, "C5")]
SPARE_TUNE = [(4, "C5"), (5.5, "A4"), (12, "G4"), (13.5, "B4"), (20, "E5"), (21.5, "C5"), (23, "A4"), (28, "G4"), (29.5, "E4")]
# What plays on each pass through the four chords: the tune, and whether the drums are in.
PASSES = [(None, False), (SPARE_TUNE, True), (TUNE, True), (SPARE_TUNE, False), (TUNE, True)]


def electric_piano(freq, velocity=0.5, ring=4.0):
    """A soft electric piano: a round tone with a little bark at the start of the note."""
    t = seconds(ring)
    brightness = 0.12 + 1.0 * velocity * np.exp(-t / 0.3)
    tone = np.sin(2 * np.pi * freq * t + brightness * np.sin(2 * np.pi * freq * t))
    tine = 0.05 * velocity * np.sin(2 * np.pi * freq * 7.0 * t) * np.exp(-t / 0.04)
    shape = np.exp(-t / (ring * 0.38)) * np.minimum(1, t / 0.005) * np.minimum(1, (ring - t) / 0.2)
    return lowpass((tone + tine) * shape, 900 + 1800 * velocity) * velocity * 0.3


def soft_kick():
    t = seconds(0.3)
    return lowpass(np.sin(2 * np.pi * (46 * t + 3 * (1 - np.exp(-t / 0.02)))) * np.exp(-t / 0.11) * np.minimum(1, t / 0.003), 300)


def brush():
    t = seconds(0.26)
    return bandpass(random.standard_normal(len(t)), 700, 3800) * (np.exp(-t / 0.075) * np.minimum(1, t / 0.006))


def round_bass(freq, length):
    t = seconds(length)
    tone = np.sin(2 * np.pi * freq * t) + 0.16 * np.sin(4 * np.pi * freq * t)
    return tone * np.minimum(1, t / 0.012) * np.minimum(1, (length - t) / 0.12) * np.exp(-t / (length * 1.2))


def tape(signal):
    """A slow wobble in the pitch, the way an old tape runs."""
    at = np.arange(len(signal)) / SR
    wobble = 0.0011 * np.sin(2 * np.pi * 0.43 * at) + 0.0004 * np.sin(2 * np.pi * 1.7 * at + 1.0)
    return np.interp(at + wobble, at, signal)


def compose_chill(props, take):
    style = CHILL_TAKES[take]
    length = total_length(props)
    beat = 60 / style["bpm"]
    swing = beat * 0.07
    keys, tune, low, drums = Mix(length + 8), Mix(length + 8), Mix(length + 8), Mix(length + 8)
    # The last chord starts on a bar line, a few seconds before the end, and rings out.
    bars_before_the_end = int((length - 7) / (beat * 8))
    last = bars_before_the_end * beat * 8
    for chord_index in range(bars_before_the_end):
        at = chord_index * beat * 8
        chord_pass = PASSES[min(chord_index // 4, len(PASSES) - 1)]
        tune_notes, drums_in = chord_pass
        root, voicing = CHILL_CHORDS[chord_index % 4]
        for index, note in enumerate(voicing):
            keys.place(electric_piano(hz(note), 0.5, 5.0), at + index * 0.022, 1.0, -0.2 + 0.13 * index)
            keys.place(electric_piano(hz(note), 0.3, 3.0), at + beat * 2.5 + swing + index * 0.012, 0.7, 0.2 - 0.13 * index)
            keys.place(electric_piano(hz(note), 0.36, 4.0), at + beat * 4 + index * 0.018, 0.85, -0.1 + 0.07 * index)
        low.place(round_bass(hz(root), beat * 2.6), at, 0.34)
        low.place(round_bass(hz(root), beat * 1.1), at + beat * 3.5 + swing, 0.2)
        low.place(round_bass(hz(root), beat * 2.0), at + beat * 4, 0.28)
        low.place(round_bass(hz(root) * 1.5, beat * 0.9), at + beat * 7 + swing, 0.2)
        if tune_notes and chord_index % 4 == 0:
            for when, note in tune_notes:
                tune.place(electric_piano(hz(note), 0.48, 3.4), at + when * beat + (swing if when % 1 else 0), 0.95, 0.12)
        if style["drums"] and drums_in:
            for bar_beat in range(8):
                place = at + bar_beat * beat
                if bar_beat % 4 == 0:
                    drums.place(soft_kick(), place, 0.42)
                if bar_beat % 4 == 2:
                    drums.place(soft_kick(), place + beat * 0.5 + swing, 0.26)
                if bar_beat % 2 == 1:
                    drums.place(brush(), place + 0.014, 0.075, -0.08)
                drums.place(hat(0.04, 7000), place, 0.012, 0.18)
                drums.place(hat(0.03, 7500), place + beat * 0.5 + swing, 0.007, 0.18)
    for index, note in enumerate(["F2", "C3", "A3", "C4", "E4", "G4"]):
        keys.place(electric_piano(hz(note), 0.42, 7.5), last + index * 0.05, 1.0, -0.25 + 0.1 * index)

    echoes(tune, beat)
    music = Mix(length + 8)
    music.add(keys.reverb(2.2, 0.32, 2600))
    music.add(tune.reverb(2.6, 0.42, 3000))
    music.add(low)
    music.add(drums.reverb(0.6, 0.12, 4000))
    music.left, music.right = lowpass(tape(music.left), 6500), lowpass(tape(music.right), 6500)
    music.left, music.right = highpass(music.left, 34)[: int(length * SR)], highpass(music.right, 34)[: int(length * SR)]
    # Comes in gently and leaves gently, because the film starts and ends on black.
    fade_in = np.minimum(1, np.arange(len(music.left)) / (2.5 * SR))
    fade_out = np.minimum(1, (len(music.left) - np.arange(len(music.left))) / (5 * SR))
    music.left *= fade_in * fade_out
    music.right *= fade_in * fade_out
    return music


# The main film's score: a lo-fi beat you can nod to, faster and busier than the Ask film's, in another key, with a real
# snare, a shuffle and a nylon string lead. It plays straight through with no interface sounds. Only its sections
# follow the film, and each change waits for the next bar line.
SECTIONS = ("hush", "low", "groove", "lift", "break", "land")


def plucked(freq, velocity=0.6, ring=2.4):
    """A nylon string: a burst of soft noise running round a loop that loses its top a little on every pass."""
    period = int(SR / freq)
    string = np.zeros(int(ring * SR))
    burst = lowpass(random.standard_normal(period), 1400 + 3200 * velocity)
    string[:period] = burst - burst.mean()
    loss = 10 ** (-3 / (ring * freq))
    for start in range(period, len(string), period):
        before = string[start - period : start]
        passed = loss * (0.62 * before + 0.38 * np.roll(before, 1))
        string[start : start + period] = passed[: len(string[start : start + period])]
    # The loop is a whole number of samples long, and its averaging adds 0.38 of a sample more, so the note comes out a
    # little flat, by more the higher it is. Stretching it puts it on its true pitch.
    index = np.arange(len(string))
    string = np.interp(index * freq / (SR / (period + 0.38)), index, string)
    body = lowpass(string, 3200) + 0.3 * bandpass(string, 90, 240)
    return body * np.minimum(1, seconds(ring) / 0.0015) * velocity * 0.9 / max(1e-6, np.abs(body).max())


def dusty_kick():
    t = seconds(0.32)
    thump = np.tanh(1.5 * np.sin(2 * np.pi * (52 * t + 6 * (1 - np.exp(-t / 0.018))))) * np.exp(-t / 0.13)
    beater = bandpass(random.standard_normal(len(t)), 800, 3000) * np.exp(-t / 0.003) * 0.1
    return lowpass((thump + beater) * np.minimum(1, t / 0.002), 1400)


def dusty_snare():
    t = seconds(0.24)
    skin = 0.55 * np.sin(2 * np.pi * 186 * t) * np.exp(-t / 0.05)
    wires = bandpass(random.standard_normal(len(t)), 1100, 5200) * np.exp(-t / 0.085)
    return lowpass((skin + wires) * np.minimum(1, t / 0.0015), 5200)


def crackle(length):
    """An old record under everything: a faint hiss, and a few dusty pops a second."""
    n = int(length * SR)
    pops = np.zeros(n)
    places = random.integers(0, n, int(length * 3.5))
    pops[places] = random.standard_normal(len(places)) * random.uniform(0.15, 1, len(places)) ** 3
    return bandpass(pops, 1400, 7000) * 3.2 + bandpass(random.standard_normal(n), 900, 6000) * 0.0035


HEADNOD_TAKES = {
    "nylon": {
        "bpm": 86,
        "swing": 0.2,
        "chords": [  # one bar each, and the last leads back to the first
            ("B1", ["A3", "D4", "F#4", "C#5"]),  # B minor 9
            ("G2", ["F#3", "B3", "D4", "A4"]),  # G major 9
            ("E2", ["G3", "B3", "D4", "F#4"]),  # E minor 9
            ("F#2", ["E3", "A#3", "C#4", "A4"]),  # F sharp 7 sharp 9
        ],
        "home": ["B1", "F#2", "D3", "A3", "D4", "F#4", "C#5"],
        "tune": [(0, "F#5"), (0.75, "E5"), (1.5, "D5"), (3, "B4"), (4.5, "D5"), (5, "E5"), (6, "F#5"), (8, "G5"), (8.75, "F#5"), (9.5, "D5"), (11, "B4"), (12, "A#4"), (12.75, "C#5"), (13.5, "E5"), (15, "C#5")],
        "spare": [(1.5, "D5"), (3, "B4"), (6, "F#5"), (9.5, "D5"), (11, "B4"), (13.5, "C#5")],
    },
}
PICKING = [(0, 1), (3, 2), (6, 3), (8, 2), (11, 1), (14, 3)]  # which sixteenth of the bar, which note of the chord


def duck(beats, length, amount=0.22, recovery=0.24):
    """How far everything melodic sinks under each kick, so the pulse breathes."""
    envelope = np.ones(int(length * SR))
    t = np.arange(int(recovery * 3 * SR)) / SR
    dip = 1 - amount * np.exp(-t / (recovery / 2.2))
    for at in beats:
        start = int(at * SR)
        end = min(len(envelope), start + len(dip))
        if start < len(envelope):
            envelope[start:end] = np.minimum(envelope[start:end], dip[: end - start])
    return envelope


def compose_headnod(props, take):
    style = HEADNOD_TAKES[take]
    offset = props["opening"]["seconds"]
    length = total_length(props)
    beat = 60 / style["bpm"]
    bar = beat * 4
    sixteenth = beat / 4
    cues = sorted(({"at": cue["at"] + offset, "section": cue["level"]} for cue in props["cues"]), key=lambda cue: cue["at"])
    for cue in cues:
        if cue["section"] not in SECTIONS:
            raise ValueError(f"No section {cue['section']}. The sections are {SECTIONS}")
    # The grid runs in its own time, starting before the film, so a bar line falls where the film's take begins.
    film_starts = int(np.ceil(offset / bar)) * bar - offset
    section_at = lambda when: next((cue["section"] for cue in reversed(cues) if cue["at"] <= when - film_starts), "hush")
    land = next(cue["at"] for cue in cues if cue["section"] == "land") + film_starts
    land_bar = int(np.ceil(land / bar))
    buffer = film_starts + length + 9
    keys, lead, low, drums = Mix(buffer), Mix(buffer), Mix(buffer), Mix(buffer)
    kicks = []

    for index in range(land_bar):
        at = index * bar
        section = section_at(at)
        counted = index - land_bar  # counted back from the landing, so the loop always comes home on its first chord
        root, voicing = style["chords"][counted % 4]
        step = lambda place: at + place * sixteenth + (style["swing"] * sixteenth if place % 2 else 0)
        for order, note in enumerate(voicing):
            keys.place(felt(hz(note), 0.52, 2.6), at + order * 0.012, 0.8, -0.2 + 0.13 * order)
            keys.place(felt(hz(note), 0.36, 1.5), step(6) + order * 0.008, 0.6, 0.2 - 0.13 * order)
        for place, which in PICKING[::3] if section == "break" else PICKING:
            lead.place(plucked(hz(voicing[which]) * 2, 0.42 + 0.1 * (place % 8 == 0), 1.5), step(place), 0.38, 0.32 if place % 4 else -0.32)
        if section != "hush":
            low.place(round_bass(hz(root), beat * 1.3), at, 0.3)
            low.place(round_bass(hz(root), sixteenth * 1.6), step(7), 0.18)
            low.place(round_bass(hz(root) * 1.5, beat * 0.9), step(10), 0.22)
            low.place(round_bass(hz(root) * 2, sixteenth * 1.4), step(14), 0.15)
        if section not in ("hush", "break"):
            for place in range(0, 16, 2):
                drums.place(hat(0.035, 6800), step(place), 0.03 if place % 4 == 0 else 0.018, 0.18)
        if section in ("groove", "lift"):
            for place, gain in ((0, 0.5), (7, 0.24), (10, 0.4)):
                drums.place(dusty_kick(), step(place), gain)
                kicks.append(step(place))
            for place in (4, 12):
                drums.place(dusty_snare(), step(place) + 0.012, 0.17, -0.06)  # a touch late, which is the lazy feel
            for place in (3, 9, 15):
                drums.place(dusty_snare()[: int(0.05 * SR)], step(place), 0.018, 0.1)
            for place in range(1, 16, 2):
                drums.place(hat(0.025, 7400), step(place), 0.011, 0.18)
        if counted % 4 == 0 and section != "hush":
            full = section == "lift" or (section == "groove" and (counted // 4) % 2 == 0)
            for when, note in style["tune"] if full else style["spare"]:
                place = at + when * beat + (style["swing"] * sixteenth * 2 if when % 0.5 else 0)
                lead.place(plucked(hz(note), 0.62 if full else 0.5), place, 1.1, 0.1)

    # The landing rings out, spread like a slow strum, over the film's last seconds.
    for order, note in enumerate(style["home"]):
        keys.place(felt(hz(note), 0.55, 6.5), land_bar * bar + order * 0.045, 1.0, -0.25 + 0.08 * order)
        if order > 1:
            lead.place(plucked(hz(note) * 2, 0.34, 3.6), land_bar * bar + 0.4 + order * 0.1, 0.5, -0.3 + 0.1 * order)
    low.place(round_bass(hz(style["home"][0]), beat * 5), land_bar * bar, 0.28)

    echoes(lead, beat)
    sink = duck(kicks, buffer)
    for layer in (keys, lead, low):
        layer.left *= sink
        layer.right *= sink
    music = Mix(buffer)
    music.add(keys.reverb(1.5, 0.24, 2800))
    music.add(lead.reverb(1.9, 0.3, 3600))
    music.add(low)
    music.add(drums.reverb(0.4, 0.1, 4200))
    dust = crackle(buffer)
    music.place(dust, 0, 0.05, 0.1)
    music.left, music.right = lowpass(tape(music.left), 7200), lowpass(tape(music.right), 7200)
    first, last = int(film_starts * SR), int((film_starts + length) * SR)
    music.left, music.right = highpass(music.left, 36)[first:last], highpass(music.right, 36)[first:last]
    fade_in = np.minimum(1, np.arange(len(music.left)) / (1.2 * SR))
    fade_out = np.minimum(1, (len(music.left) - np.arange(len(music.left))) / (4 * SR))
    music.left *= fade_in * fade_out
    music.right *= fade_in * fade_out
    return music


def write(music, path):
    """Soft-limits, fades, and sets the loudness web video expects."""
    fade = int(1.4 * SR)
    stereo = np.stack([music.left, music.right], axis=1)
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    stereo = np.tanh(stereo * 0.9 / max(1e-6, np.percentile(np.abs(stereo), 99.9)))
    raw = path.with_suffix(".f32")
    stereo.astype("float32").tofile(raw)
    base = ["ffmpeg", "-y", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", str(raw)]
    measured = subprocess.run(
        [*base, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True
    ).stderr
    stats = json.loads(measured[measured.rindex("{") : measured.rindex("}") + 1])
    # One steady gain for the whole film, so the quiet openings stay quiet.
    settings = (
        f"loudnorm=I=-16:TP=-1.5:LRA=20:linear=true:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
        f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}"
    )
    subprocess.run([*base, "-af", settings, "-ar", str(SR), str(path)], check=True, capture_output=True)
    raw.unlink()


def main():
    props = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    chill = props.get("score") == "chill"
    for name in CHILL_TAKES if chill else HEADNOD_TAKES:
        random.bit_generator.state = np.random.default_rng(7).bit_generator.state  # each take alone is repeatable
        write(compose_chill(props, name) if chill else compose_headnod(props, name), out / f"{name}.wav")
        print("wrote", out / f"{name}.wav")


if __name__ == "__main__":
    main()
