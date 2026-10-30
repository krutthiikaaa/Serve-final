import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import 'states.dart';

/// Student Firebase + SERVE registration, rendered inside the central popup.
///
/// Without [lockedEmail] this creates the Firebase account then POSTs
/// `/auth/student/register`. With it, a signed-in Firebase user completes
/// their SERVE profile (the AuthGate "unregistered" path).
class StudentRegisterForm extends StatefulWidget {
  const StudentRegisterForm({super.key, this.lockedEmail, this.onUseDifferentAccount, this.onBackToLogin});

  final String? lockedEmail;
  final VoidCallback? onUseDifferentAccount;
  final VoidCallback? onBackToLogin;

  @override
  State<StudentRegisterForm> createState() => _StudentRegisterFormState();
}

class _StudentRegisterFormState extends State<StudentRegisterForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  late final _email = TextEditingController(text: widget.lockedEmail ?? '');
  final _password = TextEditingController();
  List<Hostel>? _hostels;
  Object? _hostelsError;
  String? _hostelId;
  bool _busy = false;
  bool _obscure = true;
  bool _accountCreated = false;
  String? _error;

  bool get _completing => widget.lockedEmail != null || _accountCreated;

  @override
  void initState() {
    super.initState();
    _loadHostels();
  }

  @override
  void didUpdateWidget(StudentRegisterForm old) {
    super.didUpdateWidget(old);
    if (widget.lockedEmail != old.lockedEmail && widget.lockedEmail != null) {
      _email.text = widget.lockedEmail!;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _loadHostels() async {
    setState(() => _hostelsError = null);
    try {
      final hostels = await context.read<ServeApi>().hostels();
      if (mounted) setState(() => _hostels = hostels);
    } catch (e) {
      if (mounted) setState(() => _hostelsError = e);
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
      if (!_completing) {
        await auth.createAccount(_email.text.trim(), _password.text);
        _accountCreated = true;
      }
      final me = await api.registerStudent(name: _name.text.trim(), email: _email.text.trim().toLowerCase(), hostelId: _hostelId!);
      auth.setMe(me);
    } on ApiException catch (e) {
      if (e.code == 'ALREADY_REGISTERED') {
        await auth.refreshMe();
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
              child: Text(
                _completing ? 'Complete your profile' : 'Create your account',
                style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your hostel decides your default night canteen.',
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
              readOnly: _completing,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              enabled: !_busy,
              decoration: InputDecoration(labelText: 'University email', helperText: _completing ? 'Signed in as this email' : null),
              validator: (v) =>
                  (v == null || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) ? 'Enter a valid email address' : null,
            ),
            if (!_completing) ...[
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
            if (_hostelsError != null)
              Row(
                children: [
                  Expanded(child: Text(errorMessage(_hostelsError!), style: const TextStyle(color: ServeColors.danger))),
                  TextButton(onPressed: _loadHostels, child: const Text('Retry')),
                ],
              )
            else
              DropdownButtonFormField<String>(
                initialValue: _hostelId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Hostel'),
                hint: Text(_hostels == null ? 'Loading hostels…' : 'Select your hostel'),
                items: [
                  for (final h in _hostels ?? const <Hostel>[])
                    DropdownMenuItem(value: h.id, child: Text('${h.name}  ·  ${h.canteen.name}', overflow: TextOverflow.ellipsis)),
                ],
                onChanged: _hostels == null || _busy ? null : (v) => setState(() => _hostelId = v),
                validator: (v) => v == null ? 'Select your hostel' : null,
              ),
            const SizedBox(height: 28),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                  : Text(_completing ? 'Finish registration' : 'Create account'),
            ),
            if (widget.onBackToLogin != null && !_completing) ...[
              const SizedBox(height: 12),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('Already have an account?', style: TextStyle(color: ServeColors.muted, fontSize: 14)),
                  TextButton(
                    style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(48, 44)),
                    onPressed: _busy ? null : widget.onBackToLogin,
                    child: const Text('Sign in'),
                  ),
                ],
              ),
            ],
            if (widget.onUseDifferentAccount != null && _completing) ...[
              const SizedBox(height: 12),
              TextButton(onPressed: _busy ? null : widget.onUseDifferentAccount, child: const Text('Use a different account')),
            ],
          ],
        ),
      ),
    );
  }
}
