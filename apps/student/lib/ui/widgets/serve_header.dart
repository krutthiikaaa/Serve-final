import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/cart_controller.dart';
import '../../state/notifications_controller.dart';
import '../navigation.dart';
import 'badge_button.dart';
import 'serve_logo.dart';

/// App header: logo, notifications (unread badge) and the olive cart button.
/// There is no hamburger menu — navigation lives in the bottom bar.
class ServeHeader extends StatelessWidget implements PreferredSizeWidget {
  const ServeHeader({super.key, this.title});
  final String? title;

  @override
  Size get preferredSize => const Size.fromHeight(68);

  @override
  Widget build(BuildContext context) {
    final cartCount = context.select<CartController, int>((c) => c.itemCount);
    final unread = context.select<NotificationsController, int>((n) => n.unreadCount);
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 10, 16, 10),
        child: Row(
          children: [
            if (title == null)
              const ServeLogo(height: 30)
            else
              Expanded(child: Text(title!, style: Theme.of(context).textTheme.headlineSmall)),
            if (title == null) const Spacer(),
            BadgeIconButton(
              icon: Icons.notifications_none_rounded,
              count: unread,
              semanticLabel: 'Notifications',
              onPressed: () => openNotifications(context),
            ),
            const SizedBox(width: 10),
            BadgeIconButton(
              icon: Icons.shopping_bag_outlined,
              count: cartCount,
              filled: true,
              semanticLabel: 'Cart',
              onPressed: () => openCart(context),
            ),
          ],
        ),
      ),
    );
  }
}
