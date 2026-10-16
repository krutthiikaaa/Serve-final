import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/cart_controller.dart';
import '../../state/notifications_controller.dart';
import '../navigation.dart';
import 'badge_button.dart';
import 'serve_logo.dart';

/// App header: the SERVE logo (or a page title), notifications with an unread
/// badge, and the cart. Navigation lives in the bottom bar (no hamburger).
class ServeHeader extends StatelessWidget implements PreferredSizeWidget {
  const ServeHeader({super.key, this.title});
  final String? title;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    final cartCount = context.select<CartController, int>((c) => c.itemCount);
    final unread = context.select<NotificationsController, int>((n) => n.unreadCount);
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 16, 8),
        child: Row(
          children: [
            Expanded(
              child: Align(
                alignment: Alignment.centerLeft,
                child: title == null
                    ? const ServeLockup(logoHeight: 36)
                    : Semantics(header: true, child: Text(title!, style: Theme.of(context).textTheme.headlineSmall)),
              ),
            ),
            BadgeIconButton(
              icon: Icons.notifications_none_rounded,
              count: unread,
              semanticLabel: 'Notifications',
              onPressed: () => openNotifications(context),
            ),
            const SizedBox(width: 8),
            BadgeIconButton(
              icon: Icons.shopping_bag_outlined,
              count: cartCount,
              highlight: true,
              semanticLabel: 'Cart',
              onPressed: () => openCart(context),
            ),
          ],
        ),
      ),
    );
  }
}
