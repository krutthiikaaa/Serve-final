import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api/models.dart';
import '../state/cart_controller.dart';
import 'widgets/states.dart';

const switchCanteenMessage = 'Your cart contains items from another canteen. Switching canteens will clear your current cart.';

/// Asks before clearing a cart that belongs to another canteen.
Future<bool> confirmSwitchCanteen(BuildContext context) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Switch canteen?'),
      content: const Text(switchCanteenMessage),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Switch Canteen'),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Adds one [item] to the cart, handling the one-canteen rule.
Future<void> addToCart(BuildContext context, MenuItem item, {required String canteenName}) async {
  final cart = context.read<CartController>();
  var result = cart.add(item, canteenName: canteenName);
  if (result == AddResult.differentCanteen) {
    if (!await confirmSwitchCanteen(context)) return;
    cart.clear();
    result = cart.add(item, canteenName: canteenName);
  }
  if (!context.mounted) return;
  switch (result) {
    case AddResult.limitReached:
      showSnack(context, 'You can order up to ${CartController.maxQuantity} of one item.');
    case AddResult.notOrderable:
      showSnack(context, '${item.name} is unavailable right now.');
    case AddResult.added:
    case AddResult.differentCanteen:
      break;
  }
}
