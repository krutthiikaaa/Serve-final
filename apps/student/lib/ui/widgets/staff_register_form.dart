import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import 'states.dart';

/// Staff request-access: Firebase sign-up then POST `/auth/staff/register`.
/// The new account stays PENDING until an admin approves it.
class StaffRegisterForm extends StatefulWidget {
  const StaffRegisterForm({super.key, required this.onSubmitted, this.onBackToLogin});

  final VoidCallback onSubmitted;
  final VoidCallback? onBackToLogin;

  @override
  State<StaffRegisterForm> createState() => _StaffRegisterFormState();
}

class _StaffRegisterFormState extends State<StaffRegisterForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  List<Ref>? _canteens;
  Object? _canteensError;
  String? _canteenId;
  bool _busy = false;
  bool _obscure = true;
  bool _accountCreated = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCanteens();
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Active canteens as attached to hostels — the same public list students see,
  /// so the form can load before a Firebase session exists.
  Future<void> _loadCanteens() async {
    setState(() => _canteensError = null);
    try {
      final hostels = await context.read<ServeApi>().hostels();
      final seen = <String>{};
      final canteens = <Ref>[];
      for (final h in hostels) {
        if (seen.add(h.canteen.id)) canteens.add(h.canteen);
      }
      if (mounted) setState(() => _canteens = canteens);
    } catch (e) {
      if (mounted) setState(() => _canteensError = e);
    }
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final auth = context.read<AuthController>();
    final api = context.read<ServeApi>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!_accountCreated) {
        await auth.createAccount(_email.text.trim(), _password.text);
        _accountCreated = true;
      }
      await api.registerStaff(
        name: _name.text.trim(),
        email: _email.text.trim().toLowerCase(),
        requestedCanteenId: _canteenId,
      );
      await auth.signOut();
      widget.onSubmitted();
    } on ApiException catch (e) {
      if (e.code == 'ALREADY_REGISTERED' || e.code == 'EMAIL_IN_USE') {
        await auth.signOut();
        if (mounted) setState(() => _error = e.userMessage);
        return;
      }
      if (mounted) setState(() => _error = e.userMessage);
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
      child: AutofillGroup(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text('Request staff access', style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
            ),
            const SizedBox(height: 8),
            Text(
              'Create your sign-in. An admin approves your access before you can operate a canteen.',
              style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: 15),
            ),
            const SizedBox(height: 22),
            if (_error != null) ...[
              NoticeBanner(message: _error!, danger: true, icon: Icons.error_outline_rounded),
              const SizedBox(height: 16),
            ],
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              textInputAction: TextInputAction.next,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Full name'),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your name' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _email,
              readOnly: _accountCreated,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Work email'),
              validator: (v) =>
                  (v == null || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) ? 'Enter a valid email address' : null,
            ),
            if (!_accountCreated) ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _password,
                obscureText: _obscure,
                autofillHints: const [AutofillHints.newPassword],
                enabled: !_busy,
                decoration: InputDecoration(
                  labelText: 'Password',
                  helperText: 'At least 6 characters',
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Show password' : 'Hide password',
                    icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                    onPressed: _busy ? null : () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (v) => (v == null || v.length < 6) ? 'Use at least 6 characters' : null,
              ),
            ],
            const SizedBox(height: 14),
            if (_canteensError != null)
              Row(
                children: [
                  Expanded(child: Text(errorMessage(_canteensError!), style: const TextStyle(color: ServeColors.danger))),
                  TextButton(onPressed: _loadCanteens, child: const Text('Retry')),
                ],
              )
            else
              DropdownButtonFormField<String>(
                initialValue: _canteenId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Canteen you work at'),
                hint: Text(_canteens == null ? 'Loading canteens…' : 'Select a canteen'),
                items: [
                  for (final c in _canteens ?? const <Ref>[])
                    DropdownMenuItem(value: c.id, child: Text(c.name, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: _canteens == null || _busy ? null : (v) => setState(() => _canteenId = v),
                validator: (v) => v == null ? 'Select a canteen' : null,
              ),
            const SizedBox(height: 28),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                  : const Text('Request access'),
            ),
            if (widget.onBackToLogin != null) ...[
              const SizedBox(height: 12),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('Already have access?', style: TextStyle(color: ServeColors.muted, fontSize: 14)),
                  TextButton(
                    style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(48, 44)),
                    onPressed: _busy ? null : widget.onBackToLogin,
                    child: const Text('Sign in'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
