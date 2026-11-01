import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Menu photo, or a category placeholder while `imageUrl` is null.
///
/// [imageUrl] is always the existing item source — this widget only sizes and
/// clips it. Pass [width]/[height] for card/hero layouts; [size] stays the
/// square thumbnail used on Home.
class FoodImage extends StatelessWidget {
  const FoodImage({
    super.key,
    required this.imageUrl,
    required this.category,
    this.size = 72,
    this.width,
    this.height,
    this.radius = 12,
  });

  final String? imageUrl;
  final String? category;
  final double size;
  final double? width;
  final double? height;
  final double radius;

  static ({IconData icon, Color bg, Color fg}) placeholderFor(String? category) {
    final c = (category ?? '').toLowerCase();
    if (c.contains('sandwich')) return (icon: Icons.lunch_dining_rounded, bg: const Color(0xFFF6EBD9), fg: const Color(0xFF9A6B2F));
    if (c.contains('juice')) return (icon: Icons.local_drink_rounded, bg: ServeColors.orangeTint, fg: ServeColors.orangeStrong);
    if (c.contains('omelet')) return (icon: Icons.egg_alt_rounded, bg: const Color(0xFFFFF4D6), fg: const Color(0xFF9A7400));
    if (c.contains('dosa')) return (icon: Icons.breakfast_dining_rounded, bg: const Color(0xFFF3EAD7), fg: const Color(0xFF8C6A2B));
    if (c.contains('beverage') || c.contains('tea') || c.contains('coffee')) {
      return (icon: Icons.coffee_rounded, bg: const Color(0xFFEFE6DF), fg: const Color(0xFF6D4C3D));
    }
    if (c.contains('desi') || c.contains('bite') || c.contains('roll')) {
      return (icon: Icons.ramen_dining_rounded, bg: ServeColors.oliveTint, fg: ServeColors.oliveInk);
    }
    return (icon: Icons.restaurant_rounded, bg: ServeColors.oliveTint, fg: ServeColors.oliveInk);
  }

  @override
  Widget build(BuildContext context) {
    final p = placeholderFor(category);
    final w = width ?? size;
    final h = height ?? size;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: ExcludeSemantics(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final extent = [
              if (w.isFinite) w,
              if (h.isFinite) h,
              if (constraints.maxWidth.isFinite) constraints.maxWidth,
              if (constraints.maxHeight.isFinite) constraints.maxHeight,
            ].fold<double>(72, (a, b) => a < b ? a : b);
            final placeholder = ColoredBox(
              color: p.bg,
              child: Center(child: Icon(p.icon, color: p.fg, size: (extent * 0.48).clamp(28, 84))),
            );
            final photo = imageUrl == null
                ? placeholder
                : Image.network(
                    imageUrl!,
                    width: w.isFinite ? w : double.infinity,
                    height: h.isFinite ? h : double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => placeholder,
                  );
            return w.isFinite || h.isFinite
                ? SizedBox(width: w.isFinite ? w : null, height: h.isFinite ? h : null, child: photo)
                : photo;
          },
        ),
      ),
    );
  }
}
