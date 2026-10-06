import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'register_screen.dart';
import 'role_selection_screen.dart';

enum _Page { roles, login, register }

/// Role selection → login / registration, as one root while signed out.
/// Signing in swaps the whole flow for the signed-in app, so no stale
/// login screens stay on the navigation stack.
class SignedOutFlow extends StatefulWidget {
  const SignedOutFlow({super.key});

  @override
  State<SignedOutFlow> createState() => _SignedOutFlowState();
}

class _SignedOutFlowState extends State<SignedOutFlow> {
  _Page _page = _Page.roles;

  void _go(_Page page) => setState(() => _page = page);

  @override
  Widget build(BuildContext context) {
    final child = switch (_page) {
      _Page.roles => RoleSelectionScreen(key: const ValueKey('roles'), onStudent: () => _go(_Page.login)),
      _Page.login => LoginScreen(key: const ValueKey('login'), onBack: () => _go(_Page.roles), onCreateAccount: () => _go(_Page.register)),
      _Page.register => RegisterScreen(key: const ValueKey('register'), onBack: () => _go(_Page.login)),
    };
    return PopScope(
      canPop: _page == _Page.roles,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _go(_page == _Page.register ? _Page.login : _Page.roles);
      },
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 220),
        transitionBuilder: (child, anim) => FadeTransition(
          opacity: anim,
          child: SlideTransition(
            position: Tween(begin: const Offset(0.04, 0), end: Offset.zero).animate(anim),
            child: child,
          ),
        ),
        child: child,
      ),
    );
  }
}
