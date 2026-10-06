import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Menu photo, or a category placeholder while `imageUrl` is null.
class FoodImage extends StatelessWidget {
  const FoodImage({super.key, required this.imageUrl, required this.category, this.size = 72, this.radius = 12});

  final String? imageUrl;
  final String? category;
  final double size;
  final double radius;

  static ({IconData icon, Color bg, Color fg}) placeholderFor(String? category) {
    final c = (category ?? '').toLowerCase();
    if (c.contains('sandwich')) return (icon: Icons.lunch_dining_rounded, bg: const Color(0xFFF6EBD9), fg: const Color(0xFF9A6B2F));
    if (c.contains('juice')) return (icon: Icons.local_drink_rounded, bg: const Color(0xFFFDEEE6), fg: ServeColors.orange);
    if (c.contains('omelet')) return (icon: Icons.egg_alt_rounded, bg: const Color(0xFFFFF4D6), fg: const Color(0xFF9A7400));
    if (c.contains('dosa')) return (icon: Icons.breakfast_dining_rounded, bg: const Color(0xFFF3EAD7), fg: const Color(0xFF8C6A2B));
    if (c.contains('beverage') || c.contains('tea') || c.contains('coffee')) {
      return (icon: Icons.coffee_rounded, bg: const Color(0xFFEFE6DF), fg: const Color(0xFF6D4C3D));
    }
    if (c.contains('desi') || c.contains('bite') || c.contains('roll')) {
      return (icon: Icons.ramen_dining_rounded, bg: ServeColors.oliveTint, fg: ServeColors.oliveDark);
    }
    return (icon: Icons.restaurant_rounded, bg: ServeColors.oliveTint, fg: ServeColors.oliveDark);
  }

  @override
  Widget build(BuildContext context) {
    final p = placeholderFor(category);
    final placeholder = Container(
      width: size,
      height: size,
      color: p.bg,
      alignment: Alignment.center,
      child: Icon(p.icon, color: p.fg, size: size * 0.46),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: ExcludeSemantics(
        child: imageUrl == null
            ? placeholder
            : Image.network(imageUrl!, width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, _, _) => placeholder),
      ),
    );
  }
}
