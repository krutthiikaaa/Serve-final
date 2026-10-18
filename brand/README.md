# SERVE brand assets

**Canonical location for the official SERVE logo.**

| File | What it is |
|---|---|
| `serve-logo.png` | The official SERVE logo, transparent PNG (169 × 181 px) |

**Where it came from.** The project owner supplied the logo as an image on the
warm off-white background (#F7F6F3), with the tagline beneath. `serve-logo.png`
is the logo cut from that image: only the surrounding background was made
transparent (the 2-pixel anti-aliased edge keeps partial transparency). The
logo's shapes, colours and proportions are unchanged. The supplied image is
small, so the logo looks soft when it is shown larger than about 120 px or on
high-density screens.

**When the original file arrives** (a larger transparent PNG or an SVG), replace
`serve-logo.png` and the copies listed below with it, keeping the file names,
and regenerate the app icons from it. Nothing else needs to change.

Rules:

- Use only the **official** logo. Do not redraw, trace, regenerate,
  approximate, crop, stretch or recolour it.
- Never place it inside a white box or card. Show it on light surfaces only
  (#F8F7F2 or white); its black line work disappears on dark backgrounds.
- The tagline is **"Order. Track. Collect."** Use it on brand moments (splash,
  role selection, sign-in), not on every screen.

Copies used by the apps (same file):

| App | Location |
|---|---|
| Student app (Flutter) | `apps/student/assets/images/serve_logo.png` |
| Staff dashboard | `apps/staff/public/brand/serve-logo.png` |
| Admin portal | `apps/admin/public/brand/serve-logo.png` |

App icons are the logo, unscaled in proportion, centred on the warm off-white
#F8F7F2: the web/PWA icons and favicon in `apps/student/web/` (also used by the
staff and admin web apps), the Android launcher icons
(`apps/student/android/app/src/main/res/mipmap-*`) and the iOS app icon set
(`apps/student/ios/Runner/Assets.xcassets/AppIcon.appiconset`).

## Palette

| Token | Hex | Use |
|---|---|---|
| Primary olive | `#879F2D` | accents, progress, icons (not text: 3:1 on white) |
| Dark olive | `#6F8425` | brand dark olive |
| Orange accent | `#E86A2E` | highlights, unread dots |
| Black | `#111111` | text |
| Warm off-white | `#F8F7F2` | page background |
| White | `#FFFFFF` | cards and surfaces |

Shades derived for accessible contrast (used by all three apps):

| Token | Hex | Use |
|---|---|---|
| Olive strong | `#687C24` | filled buttons and surfaces with white text (4.7:1) |
| Olive ink | `#55661C` | olive text and links on light surfaces (6.4:1) |
| Olive tint | `#EEF2DC` | selected states, positive pills |
| Orange strong | `#C4521C` | badges with white text (4.6:1) |
| Orange ink | `#9A3F14` | warning text on the orange tint |
| Orange tint | `#FCEBE1` | warning pills and notices |
| Muted grey | `#5F6258` | secondary text (5.8:1 on off-white) |
| Line | `#E7E4DA` | borders and dividers |
