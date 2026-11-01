import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/auth/auth_controller.dart';
import '../../state/canteen_selection.dart';
import '../../theme/serve_layout.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/serve_header.dart';
import '../widgets/serve_logo.dart';
import '../widgets/surface.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _logout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('Your cart on this device will be cleared.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) await context.read<AuthController>().signOut();
  }

  @override
  Widget build(BuildContext context) {
    final StudentMe? me = context.select<AuthController, StudentMe?>((a) => a.student);
    final selection = context.watch<CanteenSelection>();
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final padding = ServeLayout.pagePadding(width);
    final initial = me.name.trim().isEmpty ? '?' : me.name.trim()[0].toUpperCase();
    return Scaffold(
      appBar: const ServeHeader(title: 'Profile'),
      body: ListView(
        padding: EdgeInsets.fromLTRB(padding, 4, padding, 20),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [BoxShadow(color: ServeColors.ink.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
                    ),
                    child: Material(
                      color: ServeColors.oliveTint,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 26,
                              backgroundColor: ServeColors.white,
                              child: Text(
                                initial,
                                style: const TextStyle(color: ServeColors.oliveInk, fontSize: 22, fontWeight: FontWeight.w800),
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(me.name, style: theme.textTheme.titleLarge),
                                  const SizedBox(height: 2),
                                  Text(me.email, style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                                  const SizedBox(height: 8),
                                  StatusPill(
                                    label: 'Student · ${me.hostel.name}',
                                    icon: Icons.school_rounded,
                                    foreground: ServeColors.oliveInk,
                                    background: ServeColors.white,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const _GroupLabel('Pickup'),
                  _SectionCard(
                    children: [
                      _ProfileRow(icon: Icons.apartment_rounded, title: 'Hostel', subtitle: me.hostel.name),
                      _ProfileRow(icon: Icons.home_work_outlined, title: 'Default canteen', subtitle: me.defaultCanteen.name),
                      _ProfileRow(
                        icon: Icons.storefront_rounded,
                        title: 'Ordering from',
                        subtitle: selection.name ?? me.defaultCanteen.name,
                        onTap: () => openCanteenSelection(context),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const _GroupLabel('Activity'),
                  _SectionCard(
                    children: [
                      _ProfileRow(
                        icon: Icons.favorite_rounded,
                        iconBackground: ServeColors.orangeTint,
                        iconColor: ServeColors.orange,
                        title: 'Favourites',
                        onTap: () => openFavourites(context),
                      ),
                      _ProfileRow(
                        icon: Icons.receipt_long_rounded,
                        title: 'Your orders',
                        onTap: () => context.read<HomeTabs>().go(HomeTabs.orders),
                      ),
                      _ProfileRow(icon: Icons.notifications_none_rounded, title: 'Notifications', onTap: () => openNotifications(context)),
                    ],
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ServeColors.danger,
                      backgroundColor: ServeColors.dangerTint,
                      side: BorderSide(color: ServeColors.danger.withValues(alpha: 0.28)),
                    ),
                    onPressed: () => _logout(context),
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text('Log out'),
                  ),
                  const SizedBox(height: 20),
                  const Center(child: ServeLogo(height: 32)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        side: const BorderSide(color: ServeColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[if (i > 0) const Divider(indent: 64, endIndent: 16, height: 1), children[i]],
        ],
      ),
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.iconBackground = ServeColors.oliveTint,
    this.iconColor = ServeColors.oliveInk,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color iconBackground;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
      minVerticalPadding: 6,
      visualDensity: VisualDensity.comfortable,
      leading: IconTile(icon: icon, size: 40, background: iconBackground, color: iconColor),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: subtitle == null ? null : Text(subtitle!, style: const TextStyle(color: ServeColors.muted)),
      trailing: onTap == null ? null : const Icon(Icons.chevron_right_rounded, color: ServeColors.muted),
      onTap: onTap,
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 4, bottom: 6),
    child: Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleMedium)),
  );
}
