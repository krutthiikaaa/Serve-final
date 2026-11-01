import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/favourites_controller.dart';
import '../../theme/serve_theme.dart';

/// Heart control that toggles a favourite without opening details or the cart.
class FavouriteButton extends StatelessWidget {
  const FavouriteButton({super.key, required this.itemId, required this.itemName});

  final String itemId;
  final String itemName;

  @override
  Widget build(BuildContext context) {
    final saved = context.select<FavouritesController, bool>((f) => f.contains(itemId));
    return Material(
      color: ServeColors.white.withValues(alpha: 0.94),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: IconButton(
        tooltip: saved ? 'Remove $itemName from favourites' : 'Save $itemName to favourites',
        onPressed: () => context.read<FavouritesController>().toggle(itemId),
        constraints: const BoxConstraints.tightFor(width: 36, height: 36),
        padding: EdgeInsets.zero,
        iconSize: 20,
        color: saved ? ServeColors.orange : ServeColors.muted,
        icon: AnimatedSwitcher(
          duration: const Duration(milliseconds: 160),
          transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
          child: Icon(saved ? Icons.favorite_rounded : Icons.favorite_border_rounded, key: ValueKey(saved)),
        ),
      ),
    );
  }
}
