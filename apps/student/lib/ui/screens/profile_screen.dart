import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/auth/auth_controller.dart';
import '../../state/canteen_selection.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/serve_header.dart';
import '../widgets/serve_logo.dart';

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
    return Scaffold(
      appBar: const ServeHeader(title: 'Profile'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 32,
                backgroundColor: ServeColors.ink,
                child: Text(
                  me.name.trim().isEmpty ? '?' : me.name.trim()[0].toUpperCase(),
                  style: const TextStyle(color: ServeColors.white, fontSize: 26, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(me.name, style: Theme.of(context).textTheme.titleLarge),
                    Text(me.email, style: const TextStyle(color: ServeColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Card(
            child: Column(
              children: [
                ListTile(leading: const Icon(Icons.apartment_rounded), title: const Text('Hostel'), subtitle: Text(me.hostel.name)),
                const Divider(indent: 16, endIndent: 16),
                ListTile(
                  leading: const Icon(Icons.home_work_outlined),
                  title: const Text('Default canteen'),
                  subtitle: Text(me.defaultCanteen.name),
                ),
                const Divider(indent: 16, endIndent: 16),
                ListTile(
                  leading: const Icon(Icons.storefront_rounded),
                  title: const Text('Ordering from'),
                  subtitle: Text(selection.name ?? me.defaultCanteen.name),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => openCanteenSelection(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.receipt_long_rounded),
                  title: const Text('Your orders'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.read<HomeTabs>().go(HomeTabs.orders),
                ),
                const Divider(indent: 16, endIndent: 16),
                ListTile(
                  leading: const Icon(Icons.notifications_none_rounded),
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
          const SizedBox(height: 28),
          const Center(child: ServeLogo(height: 22)),
          const SizedBox(height: 4),
          const Center(
            child: Text('Order. Track. Collect.', style: TextStyle(color: ServeColors.muted)),
          ),
        ],
      ),
    );
  }
}
