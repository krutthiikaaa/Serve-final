import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../theme/serve_theme.dart';
import '../widgets/serve_logo.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';

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
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Spacer(),
                    const Center(child: ServeLogo(height: 96)),
                    const SizedBox(height: 20),
                    const Center(child: ServeWordmark(size: 28)),
                    const SizedBox(height: 10),
                    const Text(
                      serveTagline,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: ServeColors.muted, fontSize: 15, letterSpacing: 1.2),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Order from your hostel\'s night canteen, pay in the app, and collect at the counter.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted),
                    ),
                    const Spacer(flex: 2),
                    const SizedBox(height: 28),
                    Text('Continue as', style: theme.textTheme.labelLarge?.copyWith(color: ServeColors.muted)),
                    const SizedBox(height: 10),
                    _RoleCard(
                      icon: Icons.school_rounded,
                      title: 'Student',
                      subtitle: 'Order and track your food',
                      primary: true,
                      onTap: onStudent,
                    ),
                    const SizedBox(height: 10),
                    _RoleCard(
                      icon: Icons.storefront_rounded,
                      title: 'Canteen staff',
                      subtitle: 'Opens the staff dashboard',
                      trailing: Icons.open_in_new_rounded,
                      onTap: () => _openPortal(context, config.staffDashboardUrl, 'staff dashboard'),
                    ),
                    const SizedBox(height: 10),
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
    final fg = primary ? ServeColors.white : ServeColors.ink;
    return Material(
      color: primary ? ServeColors.oliveStrong : ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        side: primary ? BorderSide.none : const BorderSide(color: ServeColors.line),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              IconTile(
                icon: icon,
                size: 42,
                background: primary ? ServeColors.white.withValues(alpha: 0.16) : ServeColors.oliveTint,
                color: primary ? ServeColors.white : ServeColors.oliveInk,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: fg),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 13, color: primary ? ServeColors.white.withValues(alpha: 0.88) : ServeColors.muted),
                    ),
                  ],
                ),
              ),
              Icon(trailing, size: 20, color: primary ? ServeColors.white : ServeColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
