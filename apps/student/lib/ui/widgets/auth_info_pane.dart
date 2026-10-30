import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Status / provisioning copy shown inside the central popup.
class AuthInfoPane extends StatelessWidget {
  const AuthInfoPane({
    super.key,
    required this.icon,
    required this.heading,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String heading;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final narrow = MediaQuery.sizeOf(context).width < 380;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(color: ServeColors.oliveTint, shape: BoxShape.circle),
            child: Icon(icon, color: ServeColors.oliveInk, size: 28),
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          header: true,
          child: Text(heading, style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
        ),
        const SizedBox(height: 8),
        Text(body, style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15, height: 1.45)),
        if (actionLabel != null && onAction != null) ...[
          const SizedBox(height: 28),
          FilledButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ],
    );
  }
}
