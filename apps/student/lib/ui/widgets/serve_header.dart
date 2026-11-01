import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/cart_controller.dart';
import '../../state/favourites_controller.dart';
import '../../state/notifications_controller.dart';
import '../../theme/serve_layout.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import 'badge_button.dart';
import 'serve_logo.dart';

/// App header: the SERVE logo (or a page title), notifications with an unread
/// badge, and the cart. On phones, navigation stays in the bottom bar.
class ServeHeader extends StatelessWidget implements PreferredSizeWidget {
  const ServeHeader({super.key, this.title, this.onSearch});
  final String? title;
  final VoidCallback? onSearch;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    final cartCount = context.select<CartController, int>((c) => c.itemCount);
    final unread = context.select<NotificationsController, int>((n) => n.unreadCount);
    final saved = context.select<FavouritesController, int>((f) => f.count);
    final width = MediaQuery.sizeOf(context).width;
    final wide = width >= ServeLayout.sidebarMin;
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(wide ? 24 : (width < 360 ? 12 : 16), 8, wide ? 24 : 12, 8),
        child: Row(
          children: [
            Expanded(
              child: wide
                  ? const Row(
                      children: [
                        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: ServeLockup(logoHeight: 36)),
                        SizedBox(width: 28),
                        Expanded(child: _HeaderNav()),
                      ],
                    )
                  : Align(
                      alignment: Alignment.centerLeft,
                      child: title == null
                          ? Align(
                              alignment: Alignment.centerLeft,
                              child: width < 360
                                  ? const ServeLogo(height: 32)
                                  : const FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: ServeLockup(logoHeight: 32)),
                            )
                          : Semantics(header: true, child: Text(title!, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.headlineSmall)),
                    ),
            ),
            if (onSearch != null && width >= 360)
              IconButton(tooltip: 'Search menu', onPressed: onSearch, icon: const Icon(Icons.search_rounded)),
            if (width >= 360) ...[
              BadgeIconButton(
                icon: Icons.favorite_border_rounded,
                count: saved,
                semanticLabel: 'Favourites',
                onPressed: () => openFavourites(context),
              ),
              const SizedBox(width: 8),
            ],
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
            if (wide)
              IconButton(
                tooltip: 'Profile',
                onPressed: () => context.read<HomeTabs>().go(HomeTabs.profile),
                icon: const Icon(Icons.person_outline_rounded),
              ),
          ],
        ),
      ),
    );
  }
}

class _HeaderNav extends StatelessWidget {
  const _HeaderNav();

  static const _items = [
    (HomeTabs.home, 'Home'),
    (HomeTabs.menu, 'Menu'),
    (HomeTabs.orders, 'Orders'),
    (HomeTabs.profile, 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final selected = context.select<HomeTabs, int>((t) => t.index);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final item in _items)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: TextButton(
                onPressed: () => context.read<HomeTabs>().go(item.$1),
                style: TextButton.styleFrom(
                  foregroundColor: selected == item.$1 ? ServeColors.oliveInk : ServeColors.muted,
                  backgroundColor: selected == item.$1 ? ServeColors.oliveTint : Colors.transparent,
                  textStyle: TextStyle(fontWeight: selected == item.$1 ? FontWeight.w800 : FontWeight.w600),
                ),
                child: Text(item.$2),
              ),
            ),
        ],
      ),
    );
  }
}
