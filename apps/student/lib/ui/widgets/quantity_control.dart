import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// `+` while the item is not in the cart, then `[-] qty [+]`.
class QuantityControl extends StatelessWidget {
  const QuantityControl({
    super.key,
    required this.quantity,
    required this.onAdd,
    required this.onRemove,
    required this.itemName,
    this.enabled = true,
  });

  final int quantity;
  final VoidCallback onAdd;
  final VoidCallback onRemove;
  final String itemName;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: ScaleTransition(scale: Tween(begin: 0.9, end: 1.0).animate(anim), child: child),
      ),
      child: quantity == 0
          ? _RoundButton(
              key: const ValueKey('add'),
              icon: Icons.add_rounded,
              filled: true,
              tooltip: 'Add $itemName',
              onPressed: enabled ? onAdd : null,
            )
          : Container(
              key: const ValueKey('stepper'),
              decoration: BoxDecoration(
                color: ServeColors.white,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: ServeColors.line),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _RoundButton(icon: Icons.remove_rounded, tooltip: 'Remove one $itemName', onPressed: onRemove),
                  SizedBox(
                    width: 28,
                    child: Text(
                      '$quantity',
                      textAlign: TextAlign.center,
                      semanticsLabel: '$quantity in cart',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                  _RoundButton(icon: Icons.add_rounded, filled: true, tooltip: 'Add one more $itemName', onPressed: enabled ? onAdd : null),
                ],
              ),
            ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({super.key, required this.icon, required this.tooltip, required this.onPressed, this.filled = false});
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      constraints: const BoxConstraints.tightFor(width: 40, height: 40),
      padding: EdgeInsets.zero,
      style: IconButton.styleFrom(
        backgroundColor: filled ? (disabled ? ServeColors.line : ServeColors.olive) : Colors.transparent,
        foregroundColor: filled ? ServeColors.white : ServeColors.ink,
      ),
      icon: Icon(icon, size: 22),
    );
  }
}
