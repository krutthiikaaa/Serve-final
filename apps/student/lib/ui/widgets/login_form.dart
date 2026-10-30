import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import 'states.dart';

/// Email/password form used inside the role-selection popup for every role.
/// Controllers and busy/error state live with the parent so the fields survive
/// switching back to role selection and choosing the same role again.
class ServeLoginForm extends StatelessWidget {
  const ServeLoginForm({
    super.key,
    required this.formKey,
    required this.email,
    required this.password,
    required this.busy,
    required this.obscure,
    required this.error,
    required this.heading,
    required this.body,
    required this.onToggleObscure,
    required this.onSubmit,
    this.onCreateAccount,
    this.onForgotPassword,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController email;
  final TextEditingController password;
  final bool busy;
  final bool obscure;
  final String? error;
  final String heading;
  final String body;
  final VoidCallback onToggleObscure;
  final VoidCallback onSubmit;
  final VoidCallback? onCreateAccount;
  final VoidCallback? onForgotPassword;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final narrow = MediaQuery.sizeOf(context).width < 380;
    return Form(
      key: formKey,
      child: AutofillGroup(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(heading, style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
            ),
            const SizedBox(height: 8),
            Text(body, style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15)),
            const SizedBox(height: 22),
            AnimatedSize(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              alignment: Alignment.topCenter,
              child: error == null
                  ? const SizedBox(width: double.infinity)
                  : Padding(
                      padding: const EdgeInsets.only(bottom: 20),
                      child: NoticeBanner(message: error!, danger: true, icon: Icons.error_outline_rounded),
                    ),
            ),
            _LabeledField(
              label: 'Email',
              child: TextFormField(
                key: const Key('login-email'),
                controller: email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
                autocorrect: false,
                enabled: !busy,
                decoration: _fieldDecoration(hint: 'you@university.edu', icon: Icons.mail_outline_rounded),
                validator: (v) => (v == null || !v.contains('@')) ? 'Enter your email address' : null,
              ),
            ),
            const SizedBox(height: 18),
            _LabeledField(
              label: 'Password',
              child: TextFormField(
                key: const Key('login-password'),
                controller: password,
                obscureText: obscure,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                enabled: !busy,
                onFieldSubmitted: (_) => onSubmit(),
                decoration: _fieldDecoration(
                  hint: 'Your password',
                  icon: Icons.lock_outline_rounded,
                  suffix: IconButton(
                    tooltip: obscure ? 'Show password' : 'Hide password',
                    icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
                    onPressed: busy ? null : onToggleObscure,
                  ),
                ),
                validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
              ),
            ),
            if (onForgotPassword != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(48, 40),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: busy ? null : onForgotPassword,
                  child: const Text('Forgot password?'),
                ),
              )
            else
              const SizedBox(height: 24),
            if (onForgotPassword != null) const SizedBox(height: 8),
            _SignInButton(busy: busy, onPressed: onSubmit),
            if (onCreateAccount != null) ...[
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('New to SERVE?', style: TextStyle(color: ServeColors.muted, fontSize: 14)),
                  TextButton(
                    style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(48, 44)),
                    onPressed: busy ? null : onCreateAccount,
                    child: const Text('Create an account'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  static InputDecoration _fieldDecoration({required String hint, required IconData icon, Widget? suffix}) {
    final iconColor = WidgetStateColor.resolveWith((states) {
      if (states.contains(WidgetState.error)) return ServeColors.danger;
      if (states.contains(WidgetState.focused)) return ServeColors.oliveStrong;
      return ServeColors.muted;
    });
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w400),
      prefixIcon: Icon(icon, size: 20),
      prefixIconColor: iconColor,
      suffixIcon: suffix,
      suffixIconColor: iconColor,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
      errorStyle: const TextStyle(color: ServeColors.danger, fontWeight: FontWeight.w500, height: 1.3),
    );
  }
}

class _LabeledField extends StatelessWidget {
  const _LabeledField({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      ExcludeSemantics(
        child: Text(
          label,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: ServeColors.ink),
        ),
      ),
      const SizedBox(height: 8),
      Semantics(label: label, child: child),
    ],
  );
}

class _SignInButton extends StatelessWidget {
  const _SignInButton({required this.busy, required this.onPressed});
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final style =
        FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          padding: const EdgeInsets.symmetric(horizontal: 24),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: 0.2),
          disabledBackgroundColor: busy ? ServeColors.oliveStrong : null,
          disabledForegroundColor: busy ? ServeColors.white : null,
        ).copyWith(
          overlayColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.pressed)) return ServeColors.white.withValues(alpha: 0.16);
            if (states.contains(WidgetState.hovered) || states.contains(WidgetState.focused)) {
              return ServeColors.white.withValues(alpha: 0.08);
            }
            return null;
          }),
        );
    return FilledButton(
      style: style,
      onPressed: busy ? null : onPressed,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 160),
        child: busy
            ? const Row(
                key: ValueKey('busy'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: ServeColors.white)),
                  SizedBox(width: 12),
                  Text('Signing in…'),
                ],
              )
            : const Row(
                key: ValueKey('idle'),
                mainAxisSize: MainAxisSize.min,
                children: [Text('Sign in'), SizedBox(width: 8), Icon(Icons.arrow_forward_rounded, size: 18)],
              ),
      ),
    );
  }
}
