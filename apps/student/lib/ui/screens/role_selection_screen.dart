import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../theme/serve_theme.dart';
import '../widgets/serve_logo.dart';
import '../widgets/states.dart';

/// Students continue in the app; staff and admins are sent to their web portals.
class RoleSelectionScreen extends StatelessWidget {
  const RoleSelectionScreen({super.key, required this.onStudent});
  final VoidCallback onStudent;

  Future<void> _openPortal(BuildContext context, String? url, String name) async {
    if (url == null) {
      showSnack(context, 'The $name link is not configured for this build.');
      return;
    }
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) showSnack(context, 'Could not open the $name.');
  }

  @override
  Widget build(BuildContext context) {
    final config = context.read<AppConfig>();
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Align(alignment: Alignment.centerLeft, child: ServeLogo(height: 40)),
              const Spacer(),
              Text('Late-night food,\nready when you are.', style: theme.textTheme.headlineMedium),
              const SizedBox(height: 10),
              Text(
                'Order from your hostel\'s night canteen, pay in the app, and collect at the counter.',
                style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted),
              ),
              const SizedBox(height: 32),
              Text('Continue as', style: theme.textTheme.titleSmall?.copyWith(color: ServeColors.muted)),
              const SizedBox(height: 12),
              _RoleCard(
                icon: Icons.school_rounded,
                title: 'Student',
                subtitle: 'Order and track your food',
                primary: true,
                onTap: onStudent,
              ),
              const SizedBox(height: 12),
              _RoleCard(
                icon: Icons.storefront_rounded,
                title: 'Canteen staff',
                subtitle: 'Opens the staff dashboard',
                trailing: Icons.open_in_new_rounded,
                onTap: () => _openPortal(context, config.staffDashboardUrl, 'staff dashboard'),
              ),
              const SizedBox(height: 12),
              _RoleCard(
                icon: Icons.admin_panel_settings_rounded,
                title: 'Administrator',
                subtitle: 'Opens the admin portal',
                trailing: Icons.open_in_new_rounded,
                onTap: () => _openPortal(context, config.adminPortalUrl, 'admin portal'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.primary = false,
    this.trailing = Icons.arrow_forward_rounded,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool primary;
  final IconData trailing;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: primary ? ServeColors.olive : ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: primary ? BorderSide.none : const BorderSide(color: ServeColors.line),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Icon(icon, color: primary ? ServeColors.white : ServeColors.oliveDark, size: 28),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: primary ? ServeColors.white : ServeColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(subtitle, style: TextStyle(color: primary ? ServeColors.white.withValues(alpha: 0.85) : ServeColors.muted)),
                  ],
                ),
              ),
              Icon(trailing, color: primary ? ServeColors.white : ServeColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
