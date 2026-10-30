# Student app assets

`images/serve_logo.png` is the **official SERVE logo** (transparent PNG, a copy
of `/brand/serve-logo.png`). It is shown at its own proportions on light
surfaces only; never redraw, crop, recolour or box it.

`images/sandwich/` holds the Welcome-screen opening animation: one transparent
WebP per ingredient (`bread_top`, `lettuce`, `tomato`, `cheese`, `cucumber`,
`bread_bottom`), cut from a single generated photo of an exploded vegetable
sandwich so lighting and perspective match. Each file is cropped to its
ingredient; the crop boxes on the shared 864×1152 source canvas are listed in
`lib/ui/widgets/sandwich_intro.dart` and must be updated if a layer is replaced.

Food photos come from each menu item's `imageUrl`; while it is `null` the app
shows a per-category placeholder icon.
