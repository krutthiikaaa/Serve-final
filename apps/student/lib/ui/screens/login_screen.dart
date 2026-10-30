import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import '../widgets/auth_layout.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onBack, required this.onCreateAccount});
  final VoidCallback onBack;
  final VoidCallback onCreateAccount;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthController>().signIn(_email.text, _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: widget.onBack)),
      body: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            if (width >= AuthLayout.splitBreakpoint) return _split(constraints);
            if (width >= AuthLayout.cardBreakpoint) return _stacked(constraints, card: true);
            return _stacked(constraints, card: false);
          },
        ),
      ),
    );
  }

  Widget _formBody({required bool card}) => _LoginForm(
    formKey: _form,
    email: _email,
    password: _password,
    busy: _busy,
    obscure: _obscure,
    error: _error,
    onToggleObscure: () => setState(() => _obscure = !_obscure),
    onSubmit: _submit,
    onCreateAccount: widget.onCreateAccount,
    headingStyle: card ? null : Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 26),
  );

  /// Desktop: brand panel on the left, sign-in card on the right.
  Widget _split(BoxConstraints constraints) => AuthSplitLayout(
    constraints: constraints,
    panel: const AuthBrandPanel(
      headline: 'Good food is just a few taps away.',
      body:
          'Order from your hostel\'s night canteen, follow your order live, '
          'and collect your food from the counter as soon as it\'s ready.',
      footer: _Steps(),
    ),
    side: AuthEntrance(
      delay: const Duration(milliseconds: 80),
      child: _LoginCard(child: _formBody(card: true)),
    ),
  );

  /// Tablet and phone: brand on top, form below (inside a card on tablets).
  Widget _stacked(BoxConstraints constraints, {required bool card}) {
    final form = _formBody(card: card);
    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: EdgeInsets.fromLTRB(card ? 32 : 24, 4, card ? 32 : 24, 32),
      child: ConstrainedBox(
        constraints: BoxConstraints(minHeight: constraints.maxHeight - 36),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: AuthEntrance(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const AuthCompactBrand(),
                  SizedBox(height: card ? 32 : 36),
                  if (card) _LoginCard(child: form) else form,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The three steps of an order, under the brand panel's headline.
class _Steps extends StatelessWidget {
  const _Steps();

  @override
  Widget build(BuildContext context) => const Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Divider(color: ServeColors.line),
      SizedBox(height: 24),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _Step(icon: Icons.restaurant_menu_rounded, title: 'Order', body: 'Browse the menu and pay in the app'),
          ),
          SizedBox(width: 20),
          Expanded(
            child: _Step(icon: Icons.timelapse_rounded, title: 'Track', body: 'Watch your order move live'),
          ),
          SizedBox(width: 20),
          Expanded(
            child: _Step(icon: Icons.takeout_dining_rounded, title: 'Collect', body: 'Pick it up when it\'s ready'),
          ),
        ],
      ),
    ],
  );
}

class _Step extends StatelessWidget {
  const _Step({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      IconTile(icon: icon, size: 40, background: ServeColors.white),
      const SizedBox(height: 12),
      Text(
        title,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ServeColors.ink),
      ),
      const SizedBox(height: 3),
      Text(body, style: const TextStyle(fontSize: 13, color: ServeColors.muted, height: 1.4)),
    ],
  );
}

class _LoginCard extends StatelessWidget {
  const _LoginCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(maxWidth: 440),
    padding: const EdgeInsets.fromLTRB(36, 40, 36, 28),
    decoration: BoxDecoration(
      color: ServeColors.white,
      borderRadius: BorderRadius.circular(ServeSpace.radiusCard + 4),
      border: Border.all(color: ServeColors.line),
      boxShadow: const [BoxShadow(color: Color(0x0A111111), blurRadius: 24, offset: Offset(0, 8))],
    ),
    child: child,
  );
}

class _LoginForm extends StatelessWidget {
  const _LoginForm({
    required this.formKey,
    required this.email,
    required this.password,
    required this.busy,
    required this.obscure,
    required this.error,
    required this.onToggleObscure,
    required this.onSubmit,
    required this.onCreateAccount,
    this.headingStyle,
  });
  final GlobalKey<FormState> formKey;
  final TextEditingController email;
  final TextEditingController password;
  final bool busy;
  final bool obscure;
  final String? error;
  final VoidCallback onToggleObscure;
  final VoidCallback onSubmit;
  final VoidCallback onCreateAccount;
  final TextStyle? headingStyle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Form(
      key: formKey,
      child: AutofillGroup(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text('Welcome back', style: headingStyle ?? theme.textTheme.headlineMedium)),
            const SizedBox(height: 8),
            Text(
              'Sign in to continue to your SERVE account.',
              style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15),
            ),
            const SizedBox(height: 28),
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
                decoration: _fieldDecoration(label: 'Email', hint: 'you@university.edu', icon: Icons.mail_outline_rounded),
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
                onFieldSubmitted: (_) => onSubmit(),
                decoration: _fieldDecoration(
                  label: 'Password',
                  hint: 'Your password',
                  icon: Icons.lock_outline_rounded,
                  suffix: IconButton(
                    tooltip: obscure ? 'Show password' : 'Hide password',
                    icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
                    onPressed: onToggleObscure,
                  ),
                ),
                validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
              ),
            ),
            const SizedBox(height: 28),
            _SignInButton(busy: busy, onPressed: onSubmit),
            const SizedBox(height: 20),
            Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('New to SERVE?', style: TextStyle(color: ServeColors.muted, fontSize: 14)),
                TextButton(
                  style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(48, 44)),
                  onPressed: onCreateAccount,
                  child: const Text('Create an account'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static InputDecoration _fieldDecoration({required String label, required String hint, required IconData icon, Widget? suffix}) {
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

/// A field with its label set above it. Screen readers get the label from the
/// field's prefix icon instead, so the field stays one node and its suffix
/// button (the password toggle) stays separately reachable.
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
          // While signing in the button stays olive; only the label changes.
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
