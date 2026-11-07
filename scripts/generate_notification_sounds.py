#!/usr/bin/env python3
"""
Generate crisp, pleasant 16-bit 44.1kHz mono PCM WAV notification sounds for Taskly.
"""
import math
import struct
import wave
import os

SAMPLE_RATE = 44100
MAX_AMP = 32767 * 0.85  # Avoid clipping, ~-1.4dB peak

def save_wav(filename, samples):
    # Ensure directory exists
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with wave.open(filename, 'wb') as wf:
        wf.setnchannels(1)        # mono
        wf.setsampwidth(2)        # 16-bit
        wf.setframerate(SAMPLE_RATE)
        # Pack samples
        packed = bytearray()
        for s in samples:
            val = max(-32767, min(32767, int(s)))
            packed.extend(struct.pack('<h', val))
        wf.writeframes(packed)
    print(f"Generated {filename}: {len(samples)} samples, {len(packed)} bytes ({len(samples)/SAMPLE_RATE:.2f}s)")

def gen_soft_bell():
    # Warm bell: 880 Hz (A5), with harmonic overtones and exponential decay
    duration = 0.75
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        # Envelope: 4ms linear attack, exponential decay
        env = min(1.0, t / 0.004) * math.exp(-4.5 * t)
        # Harmonics
        f = 880.0
        wave_val = (
            1.0 * math.sin(2 * math.pi * f * t) +
            0.45 * math.sin(2 * math.pi * (f * 2.02) * t) * math.exp(-3.0 * t) +
            0.20 * math.sin(2 * math.pi * (f * 3.01) * t) * math.exp(-6.0 * t) +
            0.10 * math.sin(2 * math.pi * (f * 4.2) * t) * math.exp(-8.0 * t)
        )
        samples.append(MAX_AMP * env * wave_val / 1.75)
    return samples

def gen_classic():
    # Two-tone friendly chime: E5 (659.25 Hz) then A5 (880 Hz)
    duration = 0.60
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    t_split = 0.14
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        if t < t_split:
            # First note
            env = min(1.0, t / 0.005) * math.exp(-6.0 * t)
            f = 659.25
            sig = math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * 2 * f * t)
            samples.append(MAX_AMP * env * sig / 1.3)
        else:
            t2 = t - t_split
            env = min(1.0, t2 / 0.005) * math.exp(-5.0 * t2)
            f = 880.0
            sig = math.sin(2 * math.pi * f * t2) + 0.25 * math.sin(2 * math.pi * 2 * f * t2)
            samples.append(MAX_AMP * env * sig / 1.25)
    return samples

def gen_pop():
    # Crisp digital pop: fast pitch chirp upwards then damped decay
    duration = 0.09
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        # Frequency rises rapidly from 350 to 950
        freq = 350.0 + (950.0 - 350.0) * math.sin(min(1.0, t / 0.025) * math.pi / 2)
        env = min(1.0, t / 0.003) * math.exp(-35.0 * t)
        sig = math.sin(2 * math.pi * freq * t)
        samples.append(MAX_AMP * env * sig)
    return samples

def gen_bubble():
    # Round bubble sound: smooth frequency rise from 420 Hz to 820 Hz with rounded resonance
    duration = 0.18
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        progress = min(1.0, t / 0.08)
        freq = 420.0 + 400.0 * (progress ** 1.8)
        env = min(1.0, t / 0.006) * math.exp(-14.0 * t)
        sig = math.sin(2 * math.pi * freq * t) + 0.15 * math.sin(2 * math.pi * freq * 2 * t)
        samples.append(MAX_AMP * env * sig / 1.15)
    return samples

def gen_glass():
    # Glass tap: high crystalline frequency with resonant ring
    duration = 0.50
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        env = min(1.0, t / 0.002) * math.exp(-7.5 * t)
        f1 = 2349.3  # D7
        f2 = 4698.6  # D8
        f3 = 1174.6  # D6
        sig = (
            1.0 * math.sin(2 * math.pi * f1 * t) +
            0.5 * math.sin(2 * math.pi * f2 * t) * math.exp(-5.0 * t) +
            0.2 * math.sin(2 * math.pi * f3 * t)
        )
        samples.append(MAX_AMP * env * sig / 1.7)
    return samples

def gen_marimba():
    # Warm wooden marimba strike: 440 Hz fundamental + characteristic wood mallet thump
    duration = 0.55
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        env = min(1.0, t / 0.005) * math.exp(-7.0 * t)
        f = 440.0
        # Marimba overtones are around 4x (octave + major sixth) in acoustic instruments
        sig = (
            1.0 * math.sin(2 * math.pi * f * t) +
            0.35 * math.sin(2 * math.pi * (f * 3.9) * t) * math.exp(-12.0 * t) +
            0.15 * math.sin(2 * math.pi * (f * 9.2) * t) * math.exp(-25.0 * t)
        )
        samples.append(MAX_AMP * env * sig / 1.5)
    return samples

def gen_melody():
    # 3-note calm ascending melody: C5 (523.25), E5 (659.25), G5 (783.99)
    duration = 0.70
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    notes = [
        (0.00, 0.12, 523.25),
        (0.12, 0.24, 659.25),
        (0.24, 0.70, 783.99)
    ]
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        val = 0.0
        for start, end, freq in notes:
            if t >= start and t <= end:
                dt = t - start
                env = min(1.0, dt / 0.005) * math.exp(-5.0 * dt)
                sig = math.sin(2 * math.pi * freq * dt) + 0.2 * math.sin(2 * math.pi * 2 * freq * dt)
                val += env * sig
            elif t > end:
                # Allow tail of previous notes to ring out softly
                dt = t - start
                env = math.exp(-7.0 * dt)
                if env > 0.001:
                    sig = math.sin(2 * math.pi * freq * dt) + 0.2 * math.sin(2 * math.pi * 2 * freq * dt)
                    val += env * sig * 0.4
        samples.append(MAX_AMP * min(1.0, max(-1.0, val * 0.75)))
    return samples

def gen_water_drop():
    # Organic water droplet: pitch drops quickly from 1100 to 750, then resonance
    duration = 0.32
    total_samples = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        env = min(1.0, t / 0.004) * math.exp(-12.0 * t)
        # Non-linear pitch sweep
        f = 750.0 + 350.0 * math.exp(-25.0 * t)
        sig = math.sin(2 * math.pi * f * t) + 0.15 * math.sin(2 * math.pi * 1.5 * f * t)
        samples.append(MAX_AMP * env * sig / 1.15)
    return samples

SOUND_GENERATORS = {
    'taskly_soft_bell.wav': gen_soft_bell,
    'taskly_classic.wav': gen_classic,
    'taskly_pop.wav': gen_pop,
    'taskly_bubble.wav': gen_bubble,
    'taskly_glass.wav': gen_glass,
    'taskly_marimba.wav': gen_marimba,
    'taskly_melody.wav': gen_melody,
    'taskly_water_drop.wav': gen_water_drop,
}

TARGET_DIRS = [
    'public/assets/sounds',
    'android/app/src/main/res/raw'
]

def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    for name, generator in SOUND_GENERATORS.items():
        samples = generator()
        for target_dir in TARGET_DIRS:
            filepath = os.path.join(root, target_dir, name)
            save_wav(filepath, samples)

if __name__ == '__main__':
    main()

