import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Round icon button with a count badge (cart, notifications).
class BadgeIconButton extends StatelessWidget {
  const BadgeIconButton({
    super.key,
    required this.icon,
    required this.count,
    required this.onPressed,
    required this.semanticLabel,
    this.highlight = false,
  });

  final IconData icon;
  final int count;
  final VoidCallback onPressed;
  final String semanticLabel;

  /// The cart: olive badge, and an olive tint once it holds something.
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final label = count > 0 ? '$semanticLabel, $count' : semanticLabel;
    final active = highlight && count > 0;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: SizedBox(
        width: 46,
        height: 46,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              decoration: ShapeDecoration(
                color: active ? ServeColors.oliveTint : ServeColors.white,
                shape: CircleBorder(side: BorderSide(color: active ? ServeColors.oliveTint : ServeColors.line)),
              ),
              child: Material(
                type: MaterialType.transparency,
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: onPressed,
                  child: Center(child: Icon(icon, color: active ? ServeColors.oliveInk : ServeColors.ink, size: 22)),
                ),
              ),
            ),
            if (count > 0)
              Positioned(
                top: -3,
                right: -3,
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
                  child: Container(
                    key: ValueKey(count),
                    constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: highlight ? ServeColors.oliveStrong : ServeColors.orangeStrong,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: ServeColors.paper, width: 2),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      count > 99 ? '99+' : '$count',
                      style: const TextStyle(color: ServeColors.white, fontSize: 11, fontWeight: FontWeight.w800, height: 1.1),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
