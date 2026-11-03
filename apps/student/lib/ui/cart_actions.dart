import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api/models.dart';
import '../state/canteen_selection.dart';
import '../state/cart_controller.dart';
import 'widgets/states.dart';

const switchCanteenMessage =
    'Your cart contains items from another canteen. Switching canteens will clear your current cart.';
const switchPeriodMessage =
    'Your cart contains items from a different day or night service. Switching will clear your current cart.';

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

Future<bool> confirmSwitchPeriod(BuildContext context) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Switch service?'),
      content: const Text(switchPeriodMessage),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Switch service'),
        ),
      ],
    ),
  );
  return result ?? false;
}

Future<bool> confirmCartContextChange(
  BuildContext context, {
  required String canteenId,
  required ServicePeriod period,
}) async {
  final cart = context.read<CartController>();
  if (!cart.conflictsWith(canteenId: canteenId, period: period)) return true;
  if (cart.canteenId != canteenId) {
    if (!await confirmSwitchCanteen(context)) return false;
  } else if (!await confirmSwitchPeriod(context)) {
    return false;
  }
  if (!context.mounted) return false;
  context.read<CartController>().clear();
  return true;
}

/// Adds one [item] to the cart, handling the one-canteen and one-period rules.
Future<void> addToCart(BuildContext context, MenuItem item, {required String canteenName}) async {
  final cart = context.read<CartController>();
  final period = context.read<CanteenSelection>().period;
  var result = cart.add(item, canteenName: canteenName, period: period);
  if (result == AddResult.differentCanteen) {
    if (!await confirmSwitchCanteen(context)) return;
    if (!context.mounted) return;
    cart.clear();
    result = cart.add(item, canteenName: canteenName, period: period);
  } else if (result == AddResult.differentPeriod) {
    if (!await confirmSwitchPeriod(context)) return;
    if (!context.mounted) return;
    cart.clear();
    result = cart.add(item, canteenName: canteenName, period: period);
  }
  if (!context.mounted) return;
  switch (result) {
    case AddResult.limitReached:
      showSnack(context, 'You can order up to ${CartController.maxQuantity} of one item.');
    case AddResult.notOrderable:
      showSnack(context, '${item.name} is unavailable right now.');
    case AddResult.added:
    case AddResult.differentCanteen:
    case AddResult.differentPeriod:
      break;
  }
}
