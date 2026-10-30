import 'package:flutter/material.dart';

import 'role_selection_screen.dart';

/// Signed-out authentication lives entirely in [RoleSelectionScreen]'s popup.
class SignedOutFlow extends StatelessWidget {
  const SignedOutFlow({super.key, this.completeEmail});

  final String? completeEmail;

  @override
  Widget build(BuildContext context) => RoleSelectionScreen(completeEmail: completeEmail);
}
