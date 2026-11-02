#!/usr/bin/env python3
"""
Taskly Mobile Asset Generator
Generates native App Icons and Splash Screens for Android and iOS Capacitor projects
using Taskly's Aerodynamic Paper Plane, Crimson Red (#ef4444) and Emerald Green (#10b981) brand identity.
"""

import os
from PIL import Image, ImageDraw, ImageFilter

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    logo_path = os.path.join(root, "public", "logo.png")
    
    if not os.path.exists(logo_path):
        print(f"[ERROR] Source logo not found at {logo_path}")
        return

    print("Generating Taskly Mobile Branding Assets from public/logo.png...")
    logo_src = Image.open(logo_path).convert("RGBA")

    # 1. Web Favicons & PWA Icons
    public_dir = os.path.join(root, "public")
    logo_192 = logo_src.resize((192, 192), Image.Resampling.LANCZOS)
    logo_192.save(os.path.join(public_dir, "icon-192.png"), optimize=True)
    
    logo_512 = logo_src.resize((512, 512), Image.Resampling.LANCZOS)
    logo_512.save(os.path.join(public_dir, "icon-512.png"), optimize=True)

    fav_32 = logo_src.resize((32, 32), Image.Resampling.LANCZOS)
    fav_32.save(os.path.join(public_dir, "favicon.png"), optimize=True)
    fav_32.save(os.path.join(public_dir, "favicon.ico"), format="ICO")
    print("[OK] Web icons generated (icon-192.png, icon-512.png, favicon.png, favicon.ico)")

    # 2. Android Density Mipmaps
    android_res = os.path.join(root, "android", "app", "src", "main", "res")
    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }

    if os.path.exists(android_res):
        for folder, (size, fg_size) in densities.items():
            dir_path = os.path.join(android_res, folder)
            if not os.path.exists(dir_path):
                continue

            # Standard squircle launcher icon
            icon = Image.new("RGBA", (size, size), (15, 23, 42, 255))
            glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            gdraw = ImageDraw.Draw(glow)
            gdraw.ellipse((int(size * 0.2), int(size * 0.2), int(size * 0.8), int(size * 0.8)), fill=(239, 68, 68, 50))
            glow = glow.filter(ImageFilter.GaussianBlur(max(2, int(size * 0.1))))
            icon = Image.alpha_composite(icon, glow)
            
            logo_sub = logo_src.resize((int(size * 0.74), int(size * 0.74)), Image.Resampling.LANCZOS)
            icon.alpha_composite(logo_sub, ((size - logo_sub.width) // 2, (size - logo_sub.height) // 2))
            icon.save(os.path.join(dir_path, "ic_launcher.png"), optimize=True)

            # Round launcher icon
            mask = Image.new("L", (size, size), 0)
            mdraw = ImageDraw.Draw(mask)
            mdraw.ellipse((0, 0, size - 1, size - 1), fill=255)
            round_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            round_icon.paste(icon, (0, 0), mask)
            round_icon.save(os.path.join(dir_path, "ic_launcher_round.png"), optimize=True)

            # Adaptive foreground icon
            fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
            fg_logo = logo_src.resize((int(fg_size * 0.58), int(fg_size * 0.58)), Image.Resampling.LANCZOS)
            fg.alpha_composite(fg_logo, ((fg_size - fg_logo.width) // 2, (fg_size - fg_logo.height) // 2))
            fg.save(os.path.join(dir_path, "ic_launcher_foreground.png"), optimize=True)

        print("[OK] Android density mipmaps updated!")

        # 3. Android Splash Screens
        def render_splash(w, h):
            splash = Image.new("RGBA", (w, h), (15, 23, 42, 255))
            logo_size = int(min(w, h) * 0.38)
            splash_logo = logo_src.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
            
            glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            gdraw = ImageDraw.Draw(glow)
            cx, cy = w // 2, h // 2
            gr = int(logo_size * 0.65)
            gdraw.ellipse((cx - gr, cy - gr, cx + gr, cy + gr), fill=(239, 68, 68, 60))
            gdraw.ellipse((cx - gr // 2, cy, cx + gr, cy + gr), fill=(16, 185, 129, 40))
            glow = glow.filter(ImageFilter.GaussianBlur(max(5, int(logo_size * 0.2))))
            splash = Image.alpha_composite(splash, glow)
            
            splash.alpha_composite(splash_logo, ((w - logo_size) // 2, (h - logo_size) // 2))
            return splash

        port_splash = render_splash(480, 800)
        land_splash = render_splash(800, 480)

        if os.path.exists(os.path.join(android_res, "drawable")):
            port_splash.save(os.path.join(android_res, "drawable", "splash.png"), optimize=True)

        for p_dir in ["drawable-port-mdpi", "drawable-port-hdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"]:
            p_path = os.path.join(android_res, p_dir)
            if os.path.exists(p_path):
                port_splash.save(os.path.join(p_path, "splash.png"), optimize=True)

        for l_dir in ["drawable-land-mdpi", "drawable-land-hdpi", "drawable-land-xhdpi", "drawable-land-xxhdpi", "drawable-land-xxxhdpi"]:
            l_path = os.path.join(android_res, l_dir)
            if os.path.exists(l_path):
                land_splash.save(os.path.join(l_path, "splash.png"), optimize=True)

        print("[OK] Android splash screens updated!")

    # 4. iOS Assets
    ios_icon_dir = os.path.join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    if os.path.exists(ios_icon_dir):
        ios_icon = Image.new("RGBA", (1024, 1024), (15, 23, 42, 255))
        logo_ios = logo_src.resize((740, 740), Image.Resampling.LANCZOS)
        ios_icon.alpha_composite(logo_ios, ((1024 - 740) // 2, (1024 - 740) // 2))
        ios_icon.save(os.path.join(ios_icon_dir, "AppIcon-512@2x.png"), optimize=True)

    ios_splash_dir = os.path.join(root, "ios", "App", "App", "Assets.xcassets", "Splash.imageset")
    if os.path.exists(ios_splash_dir):
        ios_splash = render_splash(1200, 1200)
        ios_splash.save(os.path.join(ios_splash_dir, "splash-2732x2732.png"), optimize=True)
        ios_splash.save(os.path.join(ios_splash_dir, "splash-2732x2732-1.png"), optimize=True)
        ios_splash.save(os.path.join(ios_splash_dir, "splash-2732x2732-2.png"), optimize=True)
        print("[OK] iOS app icon and splash screens updated!")

    print("\nAll native branding assets generated successfully!")

if __name__ == "__main__":
    main()
