import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Ingredient-to-popup mapping.
///
/// Every layer starts as part of the assembled sandwich at the centre of the
/// screen. After the burst it travels to a slot in the centred role-selection
/// popup and becomes that part of the card (same bounds, the food texture
/// colour-shifts into the brand surface):
///
/// | Layer         | Burst                         | Builds                          |
/// |---------------|-------------------------------|----------------------------------|
/// | bread_top     | up and left, −36°             | the popup's header cap           |
/// | lettuce       | up and right, +26°            | the olive band under the lockup  |
/// | tomato        | left, −20°                    | the orange accent above the copy |
/// | cheese        | right, +30°                   | the interior fill behind the copy|
/// | cucumber      | down and left, +16°           | the field behind the three roles |
/// | bread_bottom  | down and right, −22°          | the popup's base cap             |
///
/// [box] is the crop on the shared 864×1152 source photo (see assets/README.md).
class SandwichLayer {
  const SandwichLayer({
    required this.name,
    required this.asset,
    required this.box,
    required this.closedBottom,
    required this.scatter,
    required this.scatterTurn,
    required this.slot,
    required this.surface,
  });

  final String name;
  final String asset;
  final Rect box;
  final double closedBottom;

  /// Burst target, relative to the assembled sandwich's centre, in source px.
  final Offset scatter;
  final double scatterTurn;

  /// Destination inside the popup, as a fraction of the popup's size.
  final Rect slot;

  /// Brand colour this piece colour-shifts into as the card materialises.
  final Color surface;

  Offset get closedCentre => Offset(box.center.dx, closedBottom - box.height / 2);
}

const _dir = 'assets/images/sandwich';

/// Painted bottom to top, matching the photo.
const sandwichLayers = [
  SandwichLayer(
    name: 'bread_bottom',
    asset: '$_dir/bread_bottom.webp',
    box: Rect.fromLTWH(179, 840, 505, 236),
    closedBottom: 1076,
    scatter: Offset(100, 330),
    scatterTurn: -22,
    slot: Rect.fromLTWH(-0.08, 0.74, 1.16, 0.32),
    surface: ServeColors.white,
  ),
  SandwichLayer(
    name: 'cucumber',
    asset: '$_dir/cucumber.webp',
    box: Rect.fromLTWH(189, 721, 492, 154),
    closedBottom: 1015,
    scatter: Offset(-115, 190),
    scatterTurn: 16,
    slot: Rect.fromLTWH(0.05, 0.54, 0.90, 0.36),
    surface: ServeColors.white,
  ),
  SandwichLayer(
    name: 'cheese',
    asset: '$_dir/cheese.webp',
    box: Rect.fromLTWH(200, 585, 458, 157),
    closedBottom: 995,
    scatter: Offset(135, 60),
    scatterTurn: 30,
    slot: Rect.fromLTWH(-0.02, 0.26, 1.04, 0.46),
    surface: ServeColors.white,
  ),
  SandwichLayer(
    name: 'tomato',
    asset: '$_dir/tomato.webp',
    box: Rect.fromLTWH(182, 461, 499, 118),
    closedBottom: 985,
    scatter: Offset(-135, -70),
    scatterTurn: -20,
    slot: Rect.fromLTWH(0.07, 0.22, 0.42, 0.09),
    surface: ServeColors.orange,
  ),
  SandwichLayer(
    name: 'lettuce',
    asset: '$_dir/lettuce.webp',
    box: Rect.fromLTWH(169, 268, 519, 193),
    closedBottom: 975,
    scatter: Offset(125, -205),
    scatterTurn: 26,
    slot: Rect.fromLTWH(0.00, 0.10, 1.00, 0.18),
    surface: ServeColors.oliveTint,
  ),
  SandwichLayer(
    name: 'bread_top',
    asset: '$_dir/bread_top.webp',
    box: Rect.fromLTWH(175, 73, 511, 202),
    closedBottom: 946,
    scatter: Offset(-110, -350),
    scatterTurn: -36,
    slot: Rect.fromLTWH(-0.08, -0.06, 1.16, 0.26),
    surface: ServeColors.white,
  ),
];

const _specks = [
  (angle: -150.0, distance: 0.42, size: 11.0, color: ServeColors.olive),
  (angle: -118.0, distance: 0.50, size: 8.0, color: ServeColors.orange),
  (angle: -84.0, distance: 0.44, size: 10.0, color: ServeColors.oliveDark),
  (angle: -22.0, distance: 0.46, size: 12.0, color: ServeColors.orange),
  (angle: 40.0, distance: 0.40, size: 10.0, color: ServeColors.olive),
  (angle: 112.0, distance: 0.48, size: 11.0, color: ServeColors.oliveDark),
  (angle: 146.0, distance: 0.52, size: 8.0, color: ServeColors.olive),
  (angle: 178.0, distance: 0.38, size: 9.0, color: ServeColors.orange),
];

double _span(double t, double begin, double end) => ((t - begin) / (end - begin)).clamp(0.0, 1.0);

Offset _bezier(Offset a, Offset b, Offset c, double t) {
  final u = 1 - t;
  return a * (u * u) + b * (2 * u * t) + c * (t * t);
}

/// The opening sandwich: six independent photographic layers that burst
/// apart and then travel into [popup] to build the role-selection card.
class SandwichIntroStage extends StatelessWidget {
  const SandwichIntroStage({super.key, required this.progress, required this.popup, this.clipToPopup = true});

  /// 0 assembled at the centre; 1 every layer sits in its popup slot.
  final Animation<double> progress;

  /// The role-selection popup's rect, in this widget's coordinates.
  final Rect popup;

  final bool clipToPopup;

  static const appear = (0.0, 0.12);
  static const landing = (0.10, 0.20);
  static const burst = (0.18, 0.46);
  static const float = (0.40, 0.56);
  static const construct = (0.46, 0.80);

  /// Crossfade into the paper card; at 1 the overlay is gone so removing it
  /// at the end of the intro is invisible.
  static const fadeOut = (0.76, 0.92);
  static const materialise = (0.72, 0.88);

  static const _closedBottom = 1076.0;

  static final Offset assembledCentre = Offset(
    sandwichLayers.first.box.center.dx,
    (sandwichLayers.last.closedBottom - sandwichLayers.last.box.height + _closedBottom) / 2,
  );

  static final Rect frame = () {
    final left = sandwichLayers.map((l) => l.box.left).reduce(math.min);
    final right = sandwichLayers.map((l) => l.box.right).reduce(math.max);
    final top = sandwichLayers.map((l) => l.closedBottom - l.box.height).reduce(math.min) - 40;
    return Rect.fromLTRB(left - 16, top, right + 16, _closedBottom + 18);
  }();

  static double get aspectRatio => frame.width / frame.height;

  static Size get burstReach {
    double reach(double Function(SandwichLayer) along) =>
        sandwichLayers.map((l) => (along(l) + l.box.longestSide * 0.55) * 1.12).reduce(math.max);
    return Size(reach((l) => l.scatter.dx.abs() + 40) / frame.width, reach((l) => l.scatter.dy.abs() + 48) / frame.height);
  }

  /// Largest sandwich that still keeps the burst on [stage].
  static Size sandwichSizeFor(Size stage) {
    final reach = burstReach;
    final height = [
      (stage.height / 2 - 12) / reach.height,
      (stage.width / 2 - 12) / reach.width / aspectRatio,
      stage.height * 0.50,
      440.0,
    ].reduce(math.min);
    return Size(height * aspectRatio, height);
  }

  static Rect sandwichRectFor(Size stage) {
    final size = sandwichSizeFor(stage);
    final centre = Alignment(0, (assembledCentre.dy - frame.top) / frame.height * 2 - 1);
    return Rect.fromLTWH((stage.width - size.width) / 2, stage.height / 2 - (centre.y + 1) / 2 * size.height, size.width, size.height);
  }

  static Future<void> precache(BuildContext context) =>
      Future.wait([for (final l in sandwichLayers) precacheImage(AssetImage(l.asset), context, onError: (_, _) {})]);

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: AnimatedBuilder(
      animation: progress,
      builder: (context, _) => LayoutBuilder(
        builder: (context, constraints) {
          final stage = constraints.biggest;
          final sandwich = sandwichRectFor(stage);
          final t = progress.value;
          final scale = sandwich.width / frame.width;
          final bursting = Curves.easeOutCubic.transform(_span(t, burst.$1, burst.$2));
          final clip = Curves.easeOutCubic.transform(_span(t, construct.$1 + 0.04, construct.$2));
          final squash = math.sin(math.pi * _span(t, landing.$1, landing.$2)) * (1 - bursting);
          final fadeIn = Curves.easeOutBack.transform(_span(t, appear.$1, appear.$2));
          final fadeOut = 1 - Curves.easeInOutCubic.transform(_span(t, SandwichIntroStage.fadeOut.$1, SandwichIntroStage.fadeOut.$2));

          Widget layers = Stack(
            clipBehavior: Clip.none,
            children: [
              for (var i = 0; i < sandwichLayers.length; i++)
                _piece(sandwichLayers[i], i, t, scale, sandwich, popup.isEmpty ? sandwich : popup),
              if (t > burst.$1 && t < construct.$2)
                for (final s in _specks) _speck(s, t, sandwich.center, math.min(stage.width, stage.height)),
            ],
          );

          if (clipToPopup && clip > 0 && popup.isFinite && popup.width > 0) {
            layers = ClipPath(clipper: _GrowingCardClip(popup, clip), child: layers);
          }

          return Transform(
            alignment: Alignment(0, sandwich.bottom / stage.height * 2 - 1),
            transform: Matrix4.diagonal3Values(1 + 0.05 * squash, 1 - 0.07 * squash, 1),
            child: Opacity(opacity: (fadeIn / 0.4).clamp(0.0, 1.0) * fadeOut, child: layers),
          );
        },
      ),
    ),
  );

  Widget _piece(SandwichLayer layer, int i, double t, double scale, Rect sandwich, Rect popup) {
    final fromTop = sandwichLayers.length - 1 - i;
    final out = Curves.easeOutCubic.transform(_span(t, burst.$1 + fromTop * 0.012, burst.$2));
    final drift = Curves.easeInOutSine.transform(_span(t, float.$1, float.$2));
    final build = Curves.easeOutCubic.transform(_span(t, construct.$1 + fromTop * 0.008, construct.$2));
    final material = Curves.easeInOutCubic.transform(_span(t, materialise.$1, materialise.$2));
    final side = layer.scatter.dx.sign;

    final closed = sandwich.topLeft + Offset((layer.closedCentre.dx - frame.left) * scale, (layer.closedCentre.dy - frame.top) * scale);
    final flung = sandwich.center + layer.scatter * scale + Offset(28 * side, -32) * drift * scale / 1.4;
    final dest = Rect.fromLTWH(
      popup.left + layer.slot.left * popup.width,
      popup.top + layer.slot.top * popup.height,
      layer.slot.width * popup.width,
      layer.slot.height * popup.height,
    );
    final startSize = layer.box.size * scale;
    final flungSize = startSize * (1 + 0.12 * out);
    final size = Size.lerp(Size.lerp(startSize, flungSize, out), dest.size, build)!;

    final flungCentre = flung;
    final destCentre = dest.center;
    final lift =
        (flungCentre + destCentre) / 2 +
        Offset(-side * 0.22 * (destCentre - flungCentre).distance, -0.18 * (destCentre - flungCentre).distance);
    final centre = build == 0 ? Offset.lerp(closed, flungCentre, out)! : _bezier(flungCentre, lift, destCentre, build);

    final turn = (layer.scatterTurn + 10 * layer.scatterTurn.sign * drift) * out * (1 - build);

    Widget image = Image.asset(
      layer.asset,
      fit: BoxFit.fill,
      filterQuality: FilterQuality.medium,
      gaplessPlayback: true,
      errorBuilder: (_, _, _) => const SizedBox.shrink(),
    );
    if (material > 0) {
      image = ColorFiltered(
        colorFilter: ColorFilter.mode(layer.surface.withValues(alpha: material * 0.92), ui.BlendMode.srcATop),
        child: image,
      );
    }

    return Positioned(
      left: centre.dx - size.width / 2,
      top: centre.dy - size.height / 2,
      width: size.width,
      height: size.height,
      child: Transform.rotate(angle: turn * math.pi / 180, child: image),
    );
  }

  Widget _speck(({double angle, double distance, double size, Color color}) s, double t, Offset from, double span) {
    final fly = Curves.easeOutCubic.transform(_span(t, burst.$1, 0.52));
    final fade = _span(t, 0.48, construct.$2);
    final a = s.angle * math.pi / 180;
    final at = from + Offset(math.cos(a), math.sin(a)) * (s.distance * span * fly) + Offset(0, 48 * fade * fade);
    final d = s.size * (1.4 - fade);
    return Positioned(
      left: at.dx - d / 2,
      top: at.dy - d / 2,
      width: d,
      height: d,
      child: Opacity(
        opacity: (1 - fade) * _span(t, burst.$1, burst.$1 + 0.04),
        child: DecoratedBox(
          decoration: BoxDecoration(color: s.color, shape: BoxShape.circle),
        ),
      ),
    );
  }
}

/// A rounded rectangle that grows from [card]'s centre until it is the card.
class _GrowingCardClip extends CustomClipper<Path> {
  const _GrowingCardClip(this.card, this.progress);
  final Rect card;
  final double progress;

  @override
  Path getClip(Size size) {
    final radius = Radius.circular(ui.lerpDouble(80, 24, progress)!);
    final inset = (1 - progress) * math.min(card.width, card.height) * 0.18;
    final r = card.deflate(inset);
    return Path()..addRRect(RRect.fromRectAndRadius(r, radius));
  }

  @override
  bool shouldReclip(_GrowingCardClip old) => old.card != card || old.progress != progress;
}
