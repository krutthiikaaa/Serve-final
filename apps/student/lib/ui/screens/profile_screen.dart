import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/auth/auth_controller.dart';
import '../../state/canteen_selection.dart';
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
    final initial = me.name.trim().isEmpty ? '?' : me.name.trim()[0].toUpperCase();
    return Scaffold(
      appBar: const ServeHeader(title: 'Profile'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(ServeSpace.page, 8, ServeSpace.page, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 30,
                    backgroundColor: ServeColors.oliveTint,
                    child: Text(
                      initial,
                      style: const TextStyle(color: ServeColors.oliveInk, fontSize: 24, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 16),
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
                          background: ServeColors.oliveTint,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const _GroupLabel('Pickup'),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const IconTile(icon: Icons.apartment_rounded, size: 36),
                  title: const Text('Hostel'),
                  subtitle: Text(me.hostel.name),
                ),
                const Divider(indent: 68, endIndent: 16),
                ListTile(
                  leading: const IconTile(icon: Icons.home_work_outlined, size: 36),
                  title: const Text('Default canteen'),
                  subtitle: Text(me.defaultCanteen.name),
                ),
                const Divider(indent: 68, endIndent: 16),
                ListTile(
                  leading: const IconTile(icon: Icons.storefront_rounded, size: 36),
                  title: const Text('Ordering from'),
                  subtitle: Text(selection.name ?? me.defaultCanteen.name),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => openCanteenSelection(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const _GroupLabel('Activity'),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const IconTile(icon: Icons.receipt_long_rounded, size: 36),
                  title: const Text('Your orders'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.read<HomeTabs>().go(HomeTabs.orders),
                ),
                const Divider(indent: 68, endIndent: 16),
                ListTile(
                  leading: const IconTile(icon: Icons.notifications_none_rounded, size: 36),
                  title: const Text('Notifications'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => openNotifications(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: ServeColors.danger),
            onPressed: () => _logout(context),
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Log out'),
          ),
          const SizedBox(height: 32),
          const Center(child: ServeLogo(height: 40)),
        ],
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 4, bottom: 8),
    child: Semantics(
      header: true,
      child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: ServeColors.muted)),
    ),
  );
}
