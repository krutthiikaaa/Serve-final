import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/auth/auth_controller.dart';
import '../widgets/serve_logo.dart';
import '../widgets/states.dart';

/// Signed in with a staff or admin account: this app is for students only.
class WrongRoleScreen extends StatelessWidget {
  const WrongRoleScreen({super.key, required this.role});
  final String role;

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthController>();
    return Scaffold(
      appBar: AppBar(title: const ServeLogo(height: 26), automaticallyImplyLeading: false),
      body: EmptyView(
        icon: Icons.badge_outlined,
        title: role == 'ADMIN' ? 'This is an admin account' : 'This is a staff account',
        body: role == 'ADMIN' ? 'Use the SERVE admin portal on the web.' : 'Use the SERVE staff dashboard on the web.',
        action: OutlinedButton(
          style: OutlinedButton.styleFrom(minimumSize: const Size(160, 48)),
          onPressed: auth.signOut,
          child: const Text('Sign out'),
        ),
      ),
    );
  }
}

/// The account could not be loaded (backend unreachable, etc.).
class AccountErrorScreen extends StatelessWidget {
  const AccountErrorScreen({super.key, required this.error});
  final Object? error;

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthController>();
    return Scaffold(
      appBar: AppBar(
        title: const ServeLogo(height: 26),
        automaticallyImplyLeading: false,
        actions: [TextButton(onPressed: auth.signOut, child: const Text('Sign out'))],
      ),
      body: ErrorView(error: error ?? Exception('unknown'), onRetry: auth.refreshMe),
    );
  }
}
