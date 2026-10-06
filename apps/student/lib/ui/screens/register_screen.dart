import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import '../widgets/serve_logo.dart';
import '../widgets/states.dart';

/// Student registration: name, email and hostel (which decides the default
/// canteen). Without [lockedEmail] it also creates the Firebase account; with
/// it, a signed-in Firebase user completes their SERVE profile.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, this.lockedEmail, this.onBack});
  final String? lockedEmail;
  final VoidCallback? onBack;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  late final _email = TextEditingController(text: widget.lockedEmail ?? '');
  final _password = TextEditingController();
  List<Hostel>? _hostels;
  Object? _hostelsError;
  String? _hostelId;
  bool _busy = false;
  bool _accountCreated = false;
  String? _error;

  bool get _completing => widget.lockedEmail != null || _accountCreated;

  @override
  void initState() {
    super.initState();
    _loadHostels();
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
    final auth = context.read<AuthController>();
    return Scaffold(
      appBar: AppBar(
        leading: widget.onBack != null && !_accountCreated ? BackButton(onPressed: widget.onBack) : null,
        automaticallyImplyLeading: false,
        title: const ServeLogo(height: 26),
        actions: [if (widget.lockedEmail != null) TextButton(onPressed: auth.signOut, child: const Text('Sign out'))],
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
            children: [
              Text(_completing ? 'Complete your profile' : 'Create your account', style: theme.textTheme.headlineMedium),
              const SizedBox(height: 6),
              Text('Your hostel decides your default night canteen.', style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted)),
              const SizedBox(height: 24),
              if (_error != null) ...[
                NoticeBanner(message: _error!, danger: true, icon: Icons.error_outline_rounded),
                const SizedBox(height: 16),
              ],
              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                autofillHints: const [AutofillHints.name],
                textInputAction: TextInputAction.next,
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
                decoration: InputDecoration(labelText: 'University email', helperText: _completing ? 'Signed in as this email' : null),
                validator: (v) =>
                    (v == null || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) ? 'Enter a valid email address' : null,
              ),
              if (!_completing) ...[
                const SizedBox(height: 14),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: const InputDecoration(labelText: 'Password', helperText: 'At least 6 characters'),
                  validator: (v) => (v == null || v.length < 6) ? 'Use at least 6 characters' : null,
                ),
              ],
              const SizedBox(height: 14),
              if (_hostelsError != null)
                Row(
                  children: [
                    Expanded(
                      child: Text(errorMessage(_hostelsError!), style: const TextStyle(color: ServeColors.danger)),
                    ),
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
                      DropdownMenuItem(
                        value: h.id,
                        child: Text('${h.name}  ·  ${h.canteen.name}', overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: _hostels == null ? null : (v) => setState(() => _hostelId = v),
                  validator: (v) => v == null ? 'Select your hostel' : null,
                ),
              const SizedBox(height: 28),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                    : Text(_completing ? 'Finish registration' : 'Create account'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
