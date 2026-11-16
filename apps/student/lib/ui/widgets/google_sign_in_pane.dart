import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import 'states.dart';

/// Google sign-in inside the role-selection popup. SERVE accepts only SRM
/// University-AP Google accounts (@srmap.edu.in); the backend enforces it and
/// a refused account comes back with [error].
class GoogleSignInPane extends StatelessWidget {
  const GoogleSignInPane({
    super.key,
    required this.heading,
    required this.body,
    required this.busy,
    required this.onSignIn,
    this.error,
    this.buttonLabel = 'Continue with Google',
  });

  final String heading;
  final String body;
  final bool busy;
  final String? error;
  final String buttonLabel;
  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final narrow = MediaQuery.sizeOf(context).width < 380;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(heading, style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
        ),
        const SizedBox(height: 8),
        Text(body, style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15, height: 1.45)),
        const SizedBox(height: 22),
        if (error != null) ...[NoticeBanner(message: error!, danger: true, icon: Icons.error_outline_rounded), const SizedBox(height: 16)],
        FilledButton.icon(
          onPressed: busy ? null : onSignIn,
          icon: busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.login_rounded),
          label: Text(buttonLabel),
        ),
        const SizedBox(height: 12),
        Text(
          'Use your SRM University-AP Google account (@srmap.edu.in). Other accounts cannot sign in.',
          style: theme.textTheme.bodySmall?.copyWith(color: ServeColors.muted, height: 1.4),
        ),
      ],
    );
  }
}
