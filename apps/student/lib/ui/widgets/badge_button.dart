import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Circular icon button with a count badge (cart, notifications).
class BadgeIconButton extends StatelessWidget {
  const BadgeIconButton({
    super.key,
    required this.icon,
    required this.count,
    required this.onPressed,
    required this.semanticLabel,
    this.filled = false,
  });

  final IconData icon;
  final int count;
  final VoidCallback onPressed;
  final String semanticLabel;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final label = count > 0 ? '$semanticLabel, $count' : semanticLabel;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: SizedBox(
        width: 48,
        height: 48,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Material(
              color: filled ? ServeColors.olive : ServeColors.white,
              shape: CircleBorder(side: filled ? BorderSide.none : const BorderSide(color: ServeColors.line)),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onPressed,
                child: SizedBox.expand(child: Icon(icon, color: filled ? ServeColors.white : ServeColors.ink, size: 22)),
              ),
            ),
            if (count > 0)
              Positioned(
                top: -2,
                right: -2,
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
                  child: Container(
                    key: ValueKey(count),
                    constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: filled ? ServeColors.ink : ServeColors.orange,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: ServeColors.paper, width: 2),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      count > 99 ? '99+' : '$count',
                      style: const TextStyle(color: ServeColors.white, fontSize: 11, fontWeight: FontWeight.w800),
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
