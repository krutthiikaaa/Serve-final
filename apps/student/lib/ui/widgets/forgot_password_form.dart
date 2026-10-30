import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import 'states.dart';

/// Firebase password reset, shown inside the central popup.
class ForgotPasswordForm extends StatefulWidget {
  const ForgotPasswordForm({super.key, this.initialEmail, this.onBackToLogin});

  final String? initialEmail;
  final VoidCallback? onBackToLogin;

  @override
  State<ForgotPasswordForm> createState() => _ForgotPasswordFormState();
}

class _ForgotPasswordFormState extends State<ForgotPasswordForm> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.initialEmail ?? '');
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthController>().sendPasswordReset(_email.text.trim());
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final narrow = MediaQuery.sizeOf(context).width < 380;
    return Form(
      key: _form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text('Reset your password', style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
          ),
          const SizedBox(height: 8),
          Text(
            _sent
                ? 'If an account exists for this email, we sent a reset link. Check your inbox and spam folder.'
                : 'Enter the email you use to sign in. We will send a reset link if an account exists.',
            style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15),
          ),
          const SizedBox(height: 22),
          if (_error != null) ...[
            NoticeBanner(message: _error!, danger: true, icon: Icons.error_outline_rounded),
            const SizedBox(height: 16),
          ],
          if (_sent)
            const NoticeBanner(message: 'Reset email sent. You can return to sign in.', icon: Icons.mark_email_read_outlined)
          else ...[
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.done,
              enabled: !_busy,
              onFieldSubmitted: (_) => _submit(),
              decoration: const InputDecoration(labelText: 'Email'),
              validator: (v) => (v == null || !v.contains('@')) ? 'Enter your email address' : null,
            ),
            const SizedBox(height: 28),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                  : const Text('Send reset link'),
            ),
          ],
          if (widget.onBackToLogin != null) ...[
            const SizedBox(height: 12),
            TextButton(
              onPressed: _busy ? null : widget.onBackToLogin,
              child: const Text('Back to login'),
            ),
          ],
        ],
      ),
    );
  }
}
