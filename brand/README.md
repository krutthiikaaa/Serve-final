# SERVE brand assets

**Canonical location for the official SERVE logo.**

| File | Status |
|---|---|
| `serve-logo.svg` | ⏳ Awaiting the official asset from the project owner |
| `serve-logo.png` | ⏳ Awaiting the official asset (transparent background, ≥ 1024 px) |

Rules:

- Use only the **official** logo supplied by the project owner. Do not redraw,
  trace, regenerate or approximate it.
- The logo has a **transparent background**. Never place it inside a white box
  or card.
- Until the official files arrive, each app shows a clearly marked
  placeholder (the text wordmark "SERVE"), and nothing that imitates the logo.

Each frontend copies the PNG from here into its own asset slot. The slots
exist already; each app falls back to the text wordmark while a slot is empty:

| App | Destination |
|---|---|
| Student app (Flutter) | `apps/student/assets/images/serve_logo.png` |
| Staff dashboard | `apps/staff/public/brand/serve-logo.png` |
| Admin portal | `apps/admin/public/brand/serve-logo.png` |

## Palette

| Token | Hex |
|---|---|
| Primary olive | `#879F2D` |
| Dark olive | `#6F8425` |
| Orange accent | `#E86A2E` |
| Black | `#111111` |
| Warm off-white | `#F8F7F2` |
| White | `#FFFFFF` |
| Muted grey | `#5F6258` |
