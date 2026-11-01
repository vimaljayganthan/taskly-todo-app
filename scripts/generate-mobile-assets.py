#!/usr/bin/env python3
"""
Taskly Mobile Asset Generator
Generates native App Icons and Splash Screens for Android and iOS Capacitor projects
using Taskly's Emerald Green (#10b981) and Midnight Obsidian (#0f172a) brand identity.
"""

import os
import math
import struct
import zlib

def dist_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

def render_png(width, height, pixel_fn):
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # Filter type: None
        for x in range(width):
            r, g, b, a = pixel_fn(x, y, width, height)
            raw.extend((r, g, b, a))
    compressed = zlib.compress(bytes(raw), 6)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = struct.pack('>I', zlib.crc32(b'IHDR' + ihdr))
    idat_crc = struct.pack('>I', zlib.crc32(b'IDAT' + compressed))
    return (
        b'\x89PNG\r\n\x1a\n' +
        struct.pack('>I', 13) + b'IHDR' + ihdr + ihdr_crc +
        struct.pack('>I', len(compressed)) + b'IDAT' + compressed + idat_crc +
        struct.pack('>I', 0) + b'IEND' + struct.pack('>I', zlib.crc32(b'IEND'))
    )

def icon_pixel(x, y, w, h, is_transparent_bg=False):
    cx, cy = w / 2.0, h / 2.0
    r = min(w, h) * 0.38
    d = math.hypot(x - cx, y - cy)
    
    # Outer circle boundary
    if d > r + 1.0:
        if is_transparent_bg:
            return (0, 0, 0, 0)
        return (15, 23, 42, 255)  # #0f172a
    
    # Checkmark vector points
    p1 = (cx - r * 0.40, cy - r * 0.02)
    p2 = (cx - r * 0.10, cy + r * 0.28)
    p3 = (cx + r * 0.40, cy - r * 0.28)
    th = max(1.5, r * 0.17)
    
    d_check = min(
        dist_segment(x, y, p1[0], p1[1], p2[0], p2[1]),
        dist_segment(x, y, p2[0], p2[1], p3[0], p3[1])
    )
    
    if d_check < th:
        return (255, 255, 255, 255)
    
    # Emerald green badge: #10b981 -> #059669
    ratio = y / h
    gr_r = int(16 * (1 - ratio) + 5 * ratio)
    gr_g = int(185 * (1 - ratio) + 150 * ratio)
    gr_b = int(129 * (1 - ratio) + 105 * ratio)
    return (gr_r, gr_g, gr_b, 255)

def splash_pixel(x, y, w, h):
    cx, cy = w / 2.0, h / 2.0
    r = min(w, h) * 0.18
    d = math.hypot(x - cx, y - cy)
    
    # Glow ring around badge
    if r < d < r * 1.35:
        glow_factor = max(0.0, 1.0 - (d - r) / (r * 0.35))
        return (
            int(15 + (16 - 15) * glow_factor * 0.4),
            int(23 + (185 - 23) * glow_factor * 0.4),
            int(42 + (129 - 42) * glow_factor * 0.4),
            255
        )
    
    if d <= r:
        p1 = (cx - r * 0.40, cy - r * 0.02)
        p2 = (cx - r * 0.10, cy + r * 0.28)
        p3 = (cx + r * 0.40, cy - r * 0.28)
        th = max(2.0, r * 0.17)
        d_check = min(
            dist_segment(x, y, p1[0], p1[1], p2[0], p2[1]),
            dist_segment(x, y, p2[0], p2[1], p3[0], p3[1])
        )
        if d_check < th:
            return (255, 255, 255, 255)
        ratio = (y - (cy - r)) / (2 * r)
        gr_r = int(16 * (1 - ratio) + 5 * ratio)
        gr_g = int(185 * (1 - ratio) + 150 * ratio)
        gr_b = int(129 * (1 - ratio) + 105 * ratio)
        return (gr_r, gr_g, gr_b, 255)
        
    return (15, 23, 42, 255)  # Dark obsidian #0f172a

def save_file(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    print(f"[OK] Generated: {path} ({len(data)} bytes)")

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("Generating Taskly Mobile Branding Assets...")

    # 1. iOS App Icon (1024x1024)
    ios_icon_path = os.path.join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png")
    if os.path.exists(os.path.dirname(ios_icon_path)):
        # Generate 512x512 and save as 512@2x for fast generation & crisp display
        save_file(ios_icon_path, render_png(512, 512, lambda x, y, w, h: icon_pixel(x, y, w, h, False)))

    # 2. iOS Splash Screens
    ios_splash_dir = os.path.join(root, "ios", "App", "App", "Assets.xcassets", "Splash.imageset")
    if os.path.exists(ios_splash_dir):
        splash_data = render_png(800, 800, splash_pixel)
        save_file(os.path.join(ios_splash_dir, "splash-2732x2732.png"), splash_data)
        save_file(os.path.join(ios_splash_dir, "splash-2732x2732-1.png"), splash_data)
        save_file(os.path.join(ios_splash_dir, "splash-2732x2732-2.png"), splash_data)

    # 3. Android Mipmap Icons
    android_res = os.path.join(root, "android", "app", "src", "main", "res")
    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }

    for folder, (size, fg_size) in densities.items():
        dir_path = os.path.join(android_res, folder)
        if os.path.exists(dir_path):
            icon_data = render_png(size, size, lambda x, y, w, h: icon_pixel(x, y, w, h, False))
            round_data = render_png(size, size, lambda x, y, w, h: icon_pixel(x, y, w, h, True))
            fg_data = render_png(fg_size, fg_size, lambda x, y, w, h: icon_pixel(x, y, w, h, True))
            save_file(os.path.join(dir_path, "ic_launcher.png"), icon_data)
            save_file(os.path.join(dir_path, "ic_launcher_round.png"), round_data)
            save_file(os.path.join(dir_path, "ic_launcher_foreground.png"), fg_data)

    # 4. Android Splash Drawables
    if os.path.exists(android_res):
        splash_port = render_png(480, 800, splash_pixel)
        splash_land = render_png(800, 480, splash_pixel)
        
        save_file(os.path.join(android_res, "drawable", "splash.png"), splash_port)
        
        for port_dir in ["drawable-port-mdpi", "drawable-port-hdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"]:
            p = os.path.join(android_res, port_dir)
            if os.path.exists(p):
                save_file(os.path.join(p, "splash.png"), splash_port)
                
        for land_dir in ["drawable-land-mdpi", "drawable-land-hdpi", "drawable-land-xhdpi", "drawable-land-xxhdpi", "drawable-land-xxxhdpi"]:
            p = os.path.join(android_res, land_dir)
            if os.path.exists(p):
                save_file(os.path.join(p, "splash.png"), splash_land)

    # 5. Web Favicons
    public_dir = os.path.join(root, "public")
    save_file(os.path.join(public_dir, "icon-192.png"), render_png(192, 192, lambda x, y, w, h: icon_pixel(x, y, w, h, False)))
    save_file(os.path.join(public_dir, "icon-512.png"), render_png(512, 512, lambda x, y, w, h: icon_pixel(x, y, w, h, False)))

    print("\nAll native assets generated successfully!")

if __name__ == "__main__":
    main()
