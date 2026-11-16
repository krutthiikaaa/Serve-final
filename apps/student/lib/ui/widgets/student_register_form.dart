import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../theme/serve_theme.dart';
import 'states.dart';

/// SERVE student registration, rendered inside the central popup: a student
/// signed in with Google (@srmap.edu.in) but without a SERVE profile adds
/// their name and hostel. The email is the Google account's, set by the server.
class StudentRegisterForm extends StatefulWidget {
  const StudentRegisterForm({super.key, required this.lockedEmail, this.onUseDifferentAccount});

  /// The signed-in Google account's address (read-only).
  final String lockedEmail;
  final VoidCallback? onUseDifferentAccount;

  @override
  State<StudentRegisterForm> createState() => _StudentRegisterFormState();
}

class _StudentRegisterFormState extends State<StudentRegisterForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  late final _email = TextEditingController(text: widget.lockedEmail);
  List<Hostel>? _hostels;
  Object? _hostelsError;
  String? _hostelId;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadHostels();
  }

  @override
  void didUpdateWidget(StudentRegisterForm old) {
    super.didUpdateWidget(old);
    if (widget.lockedEmail != old.lockedEmail) _email.text = widget.lockedEmail;
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
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
      final me = await api.registerStudent(name: _name.text.trim(), hostelId: _hostelId!);
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
              child: Text('Complete your profile', style: theme.textTheme.headlineSmall?.copyWith(fontSize: narrow ? 24 : 26)),
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
              readOnly: true,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'University email', helperText: 'Your SRM Google account'),
            ),
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
                      child: Text('${h.name}  ·  ${h.serviceArea?.name ?? h.canteen?.name ?? ''}', overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: _hostels == null || _busy ? null : (v) => setState(() => _hostelId = v),
                validator: (v) => v == null ? 'Select your hostel' : null,
              ),
            const SizedBox(height: 28),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                  : const Text('Finish registration'),
            ),
            if (widget.onUseDifferentAccount != null) ...[
              const SizedBox(height: 12),
              TextButton(onPressed: _busy ? null : widget.onUseDifferentAccount, child: const Text('Use a different account')),
            ],
          ],
        ),
      ),
    );
  }
}
