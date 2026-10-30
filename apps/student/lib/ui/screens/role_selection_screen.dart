import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../core/api_exception.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../services/auth/sso_tab.dart';
import '../../theme/serve_theme.dart';
import '../widgets/auth_info_pane.dart';
import '../widgets/auth_layout.dart';
import '../widgets/forgot_password_form.dart';
import '../widgets/login_form.dart';
import '../widgets/sandwich_intro.dart';
import '../widgets/staff_register_form.dart';
import '../widgets/states.dart';
import '../widgets/student_register_form.dart';
import '../widgets/surface.dart';

const _headline = 'Welcome to SERVE';
const _description = 'Choose how you would like to continue.';

/// The opening transformation, as fractions of [RoleSelectionScreen.introDuration].
///
/// Paper washes in over the assembled ingredients; content eases in on top
/// of that wash so the card is never an empty white sheet.
abstract final class _Intro {
  static const card = (0.76, 0.90);
  static const settle = (0.84, 1.0);
  static const brand = (0.76, 0.90);
  static const headline = (0.78, 0.92);
  static const body = (0.80, 0.94);
  static const cards = [(0.82, 0.94), (0.84, 0.96), (0.86, 0.98)];
}

double _span(double t, (double, double) phase) => ((t - phase.$1) / (phase.$2 - phase.$1)).clamp(0.0, 1.0);

enum _Pane {
  roles,
  studentLogin,
  studentRegister,
  studentForgot,
  staffLogin,
  staffRegister,
  staffForgot,
  staffPending,
  adminLogin,
  adminForgot,
  adminProvision,
}

/// Students continue in the app; staff and admins are sent to their web portals.
///
/// Opening experience: the sandwich at the centre of the light-green field
/// bursts into its ingredients; those pieces travel into a centred popup and
/// become it. Choosing a role transforms the popup's contents into that role's
/// authentication interface. Every later step (login, create account, password
/// reset, verification) reuses the same popup. The sandwich is not replayed.
class RoleSelectionScreen extends StatefulWidget {
  const RoleSelectionScreen({super.key, this.completeEmail});

  /// When a Firebase user has no SERVE profile yet, open student registration
  /// on this email inside the popup (no sandwich replay).
  final String? completeEmail;

  static const introDuration = Duration(milliseconds: 4800);

  /// The longest the intro waits for the sandwich images before starting
  /// anyway; until then only the page colour shows.
  @visibleForTesting
  static Duration maxImageWait = const Duration(milliseconds: 1500);

  static bool _introPlayed = false;

  @visibleForTesting
  static void debugResetIntro() => _introPlayed = false;

  @override
  State<RoleSelectionScreen> createState() => _RoleSelectionScreenState();
}

class _LoginSlot {
  final form = GlobalKey<FormState>();
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  bool obscure = true;
  String? error;

  void dispose() {
    email.dispose();
    password.dispose();
  }
}

class _RoleSelectionScreenState extends State<RoleSelectionScreen> with TickerProviderStateMixin {
  late final bool _withIntro;
  late bool _playing;
  bool _started = false;
  bool _disposed = false;
  late _Pane _pane;
  String? _lockedEmail;
  late final AnimationController _intro;
  late final AnimationController _imageWait;
  final _stageKey = GlobalKey();
  final _popupKey = GlobalKey();
  final _student = _LoginSlot();
  final _staff = _LoginSlot();
  final _admin = _LoginSlot();

  @override
  void initState() {
    super.initState();
    final complete = widget.completeEmail;
    _withIntro = complete == null && !RoleSelectionScreen._introPlayed;
    _playing = _withIntro;
    _pane = complete == null ? _Pane.roles : _Pane.studentRegister;
    _lockedEmail = complete;
    RoleSelectionScreen._introPlayed = true;
    _intro = AnimationController(vsync: this, duration: RoleSelectionScreen.introDuration, value: _withIntro ? 0 : 1);
    _imageWait = AnimationController(vsync: this, duration: RoleSelectionScreen.maxImageWait);
    if (_withIntro) _intro.addStatusListener(_onStatus);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_playing || _started) return;
    _started = true;
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _playing = false;
      _intro.value = 1;
      return;
    }
    SandwichIntroStage.precache(context).then((_) => _begin());
    if (_imageWait.duration == Duration.zero) {
      _begin();
    } else {
      _imageWait.forward().whenCompleteOrCancel(_begin);
    }
  }

  void _begin() {
    if (_disposed || !_playing || _intro.isAnimating || _intro.value > 0) return;
    _intro.forward();
    _imageWait.stop();
  }

  void _onStatus(AnimationStatus status) {
    if (status.isCompleted && _playing && mounted) setState(() => _playing = false);
  }

  void _skip() {
    _intro.value = 1;
    _imageWait.stop();
  }

  @override
  void dispose() {
    _disposed = true;
    _imageWait.dispose();
    _intro.dispose();
    _student.dispose();
    _staff.dispose();
    _admin.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(RoleSelectionScreen old) {
    super.didUpdateWidget(old);
    if (widget.completeEmail != null && widget.completeEmail != old.completeEmail) {
      _lockedEmail = widget.completeEmail;
      _pane = _Pane.studentRegister;
    }
  }

  void _show(_Pane pane) {
    if (_playing) return;
    setState(() => _pane = pane);
  }

  Future<void> _back() async {
    switch (_pane) {
      case _Pane.roles:
        return;
      case _Pane.studentLogin:
      case _Pane.staffLogin:
      case _Pane.adminLogin:
        _show(_Pane.roles);
      case _Pane.studentRegister:
        if (_lockedEmail != null) {
          _lockedEmail = null;
          await context.read<AuthController>().signOut();
        }
        if (mounted) _show(_Pane.studentLogin);
      case _Pane.studentForgot:
        _show(_Pane.studentLogin);
      case _Pane.staffRegister:
      case _Pane.staffForgot:
      case _Pane.staffPending:
        _show(_Pane.staffLogin);
      case _Pane.adminForgot:
      case _Pane.adminProvision:
        _show(_Pane.adminLogin);
    }
  }

  Future<void> _openHandoff(String redirect, String? trustedBase, String name, SsoTab? tab) async {
    if (!_trustedHandoff(redirect, trustedBase)) {
      tab?.close();
      if (mounted) showSnack(context, 'The $name link is not configured for this build.');
      return;
    }
    if (tab != null) {
      tab.open(redirect);
      return;
    }
    final ok = await launchUrl(Uri.parse(redirect), mode: LaunchMode.externalApplication);
    if (!ok && mounted) showSnack(context, 'Could not open the $name.');
  }

  static bool _trustedHandoff(String redirect, String? base) {
    if (base == null || base.isEmpty) return false;
    final dest = Uri.tryParse(redirect);
    final trusted = Uri.tryParse(base);
    if (dest == null || trusted == null || dest.hasEmptyPath) return false;
    if (dest.scheme != trusted.scheme || dest.host != trusted.host || dest.port != trusted.port) {
      return false;
    }
    final params = dest.queryParameters;
    if (params.containsKey('idToken') || params.containsKey('token') || params.containsKey('customToken')) {
      return false;
    }
    return dest.path.contains('/sso/callback') && (params['code'] ?? '').length >= 16;
  }

  Rect? _popupRect() {
    final popup = _popupKey.currentContext?.findRenderObject();
    final stage = _stageKey.currentContext?.findRenderObject();
    if (popup is! RenderBox || stage is! RenderBox || !popup.hasSize || !popup.attached) return null;
    return popup.localToGlobal(Offset.zero, ancestor: stage) & popup.size;
  }

  _LoginSlot _slotFor(_Pane pane) => switch (pane) {
    _Pane.staffLogin || _Pane.staffRegister || _Pane.staffForgot || _Pane.staffPending => _staff,
    _Pane.adminLogin || _Pane.adminForgot || _Pane.adminProvision => _admin,
    _ => _student,
  };

  Future<void> _submit(_Pane pane) async {
    final slot = _slotFor(pane);
    if (slot.busy || !(slot.form.currentState?.validate() ?? false)) return;
    setState(() {
      slot.busy = true;
      slot.error = null;
    });
    final auth = context.read<AuthController>();
    final config = context.read<AppConfig>();
    final api = context.read<ServeApi>();
    SsoTab? tab;
    try {
      if (pane == _Pane.studentLogin) {
        await auth.signIn(slot.email.text, slot.password.text);
        return;
      }
      tab = openBlankSsoTab();
      final me = await auth.identify(slot.email.text, slot.password.text);
      final allowed =
          (pane == _Pane.staffLogin && me is OtherRoleMe && me.role == 'STAFF') ||
          (pane == _Pane.adminLogin && me is OtherRoleMe && me.role == 'ADMIN');
      if (!allowed) {
        tab?.close();
        await auth.signOut();
        if (mounted) setState(() => slot.error = _mismatch(pane == _Pane.staffLogin ? 'staff' : 'admin', me));
        return;
      }
      final audience = pane == _Pane.staffLogin ? 'STAFF' : 'ADMIN';
      final handoff = await api.initiateSso(audience);
      await auth.signOut();
      if (!mounted) {
        tab?.close();
        return;
      }
      await _openHandoff(
        handoff.redirectUrl,
        pane == _Pane.staffLogin ? config.staffDashboardUrl : config.adminPortalUrl,
        pane == _Pane.staffLogin ? 'staff dashboard' : 'admin portal',
        tab,
      );
      if (mounted) setState(() => _pane = _Pane.roles);
    } catch (e) {
      tab?.close();
      if (auth.isSignedIn) await auth.signOut();
      if (mounted) setState(() => slot.error = errorMessage(e));
    } finally {
      if (mounted) setState(() => slot.busy = false);
    }
  }

  static String _mismatch(String wanted, Me me) {
    final actual = switch (me) {
      StudentMe() => 'a student account',
      UnregisteredMe() => 'an unregistered account',
      OtherRoleMe(:final role) when role == 'ADMIN' => 'an admin account',
      OtherRoleMe() => 'a staff account',
    };
    final label = switch (wanted) {
      'staff' => 'Canteen Staff',
      'admin' => 'Administrator',
      _ => 'Student',
    };
    return 'This is $actual. Choose $label to continue.';
  }

  @override
  Widget build(BuildContext context) {
    final roles = _Roles(
      onStudent: () => _show(_Pane.studentLogin),
      onStaff: () => _show(_Pane.staffLogin),
      onAdmin: () => _show(_Pane.adminLogin),
    );
    final intro = _withIntro ? _intro : null;
    return PopScope(
      canPop: _pane == _Pane.roles,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: ServeColors.oliveTint,
        body: SafeArea(
          child: Stack(
            key: _stageKey,
            children: [
              if (_playing)
                Positioned.fill(
                  child: IgnorePointer(
                    child: AnimatedBuilder(
                      animation: _intro,
                      builder: (context, _) {
                        final fallback = SandwichIntroStage.sandwichRectFor(MediaQuery.sizeOf(context));
                        return SandwichIntroStage(progress: _intro, popup: _popupRect() ?? fallback);
                      },
                    ),
                  ),
                ),
              Positioned.fill(
                child: IgnorePointer(
                  ignoring: _playing,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final padding = EdgeInsets.symmetric(
                        horizontal: constraints.maxWidth < 400 ? 20 : 32,
                        vertical: constraints.maxHeight < 720 ? 16 : 24,
                      );
                      return SingleChildScrollView(
                        padding: padding,
                        child: ConstrainedBox(
                          constraints: BoxConstraints(minHeight: math.max(0, constraints.maxHeight - padding.vertical)),
                          child: Center(
                            child: KeyedSubtree(
                              key: _popupKey,
                              child: _RolePopup(
                                roles: roles,
                                intro: intro,
                                pane: _pane,
                                body: _pane == _Pane.roles ? null : _authBody(_pane),
                                onBack: _back,
                                maxBodyHeight: math.max(160, constraints.maxHeight - padding.vertical - 120),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              if (_playing) Positioned(top: 8, right: 8, child: _SkipButton(onPressed: _skip)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _authBody(_Pane pane) {
    return switch (pane) {
      _Pane.studentLogin => _loginForm(
        pane,
        heading: 'Welcome back',
        body: 'Sign in to continue to your SERVE account.',
        onCreate: () {
          _lockedEmail = null;
          _show(_Pane.studentRegister);
        },
        onForgot: () => _show(_Pane.studentForgot),
      ),
      _Pane.staffLogin => _loginForm(
        pane,
        heading: 'Staff sign in',
        body: 'Sign in to manage orders and your canteen.',
        onCreate: () => _show(_Pane.staffRegister),
        onForgot: () => _show(_Pane.staffForgot),
      ),
      _Pane.adminLogin => _loginForm(
        pane,
        heading: 'Admin sign in',
        body: 'Sign in to manage SERVE and oversee operations.',
        onCreate: () => _show(_Pane.adminProvision),
        onForgot: () => _show(_Pane.adminForgot),
      ),
      _Pane.studentRegister => StudentRegisterForm(
        lockedEmail: _lockedEmail,
        onBackToLogin: () => _show(_Pane.studentLogin),
        onUseDifferentAccount: () async {
          await context.read<AuthController>().signOut();
          if (mounted) {
            setState(() {
              _lockedEmail = null;
              _pane = _Pane.studentLogin;
            });
          }
        },
      ),
      _Pane.staffRegister => StaffRegisterForm(
        onBackToLogin: () => _show(_Pane.staffLogin),
        onSubmitted: () => _show(_Pane.staffPending),
      ),
      _Pane.studentForgot => ForgotPasswordForm(
        initialEmail: _student.email.text,
        onBackToLogin: () => _show(_Pane.studentLogin),
      ),
      _Pane.staffForgot => ForgotPasswordForm(
        initialEmail: _staff.email.text,
        onBackToLogin: () => _show(_Pane.staffLogin),
      ),
      _Pane.adminForgot => ForgotPasswordForm(
        initialEmail: _admin.email.text,
        onBackToLogin: () => _show(_Pane.adminLogin),
      ),
      _Pane.staffPending => AuthInfoPane(
        icon: Icons.schedule_rounded,
        heading: 'Request sent',
        body:
            'Your staff account is pending admin approval. You will be able to open the staff dashboard after an administrator reviews your request.',
        actionLabel: 'Back to login',
        onAction: () => _show(_Pane.staffLogin),
      ),
      _Pane.adminProvision => AuthInfoPane(
        icon: Icons.admin_panel_settings_rounded,
        heading: 'Admin accounts are provisioned',
        body:
            'SERVE does not offer public admin sign-up. Admin access is created through a controlled invitation or setup process. If you were provisioned, sign in with that email.',
        actionLabel: 'Back to login',
        onAction: () => _show(_Pane.adminLogin),
      ),
      _Pane.roles => const SizedBox.shrink(),
    };
  }

  Widget _loginForm(
    _Pane pane, {
    required String heading,
    required String body,
    required VoidCallback onCreate,
    required VoidCallback onForgot,
  }) {
    final slot = _slotFor(pane);
    return ServeLoginForm(
      formKey: slot.form,
      email: slot.email,
      password: slot.password,
      busy: slot.busy,
      obscure: slot.obscure,
      error: slot.error,
      heading: heading,
      body: body,
      onToggleObscure: () => setState(() => slot.obscure = !slot.obscure),
      onSubmit: () => _submit(pane),
      onCreateAccount: onCreate,
      onForgotPassword: onForgot,
    );
  }
}

/// The centred role-selection card. During the intro its paper surface and
/// contents grow in as the sandwich pieces arrive to build it.
class _RolePopup extends StatelessWidget {
  const _RolePopup({
    required this.roles,
    required this.intro,
    required this.pane,
    required this.body,
    required this.onBack,
    required this.maxBodyHeight,
  });
  final _Roles roles;
  final Animation<double>? intro;
  final _Pane pane;
  final Widget? body;
  final VoidCallback onBack;
  final double maxBodyHeight;

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 380;
    final motion = intro;
    final popup = ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: Material(
        color: ServeColors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AuthLayout.panelRadius),
          side: const BorderSide(color: ServeColors.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: EdgeInsets.fromLTRB(narrow ? 22 : 28, narrow ? 22 : 28, narrow ? 22 : 28, narrow ? 20 : 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Reveal(intro: motion, phase: _Intro.brand, child: const AuthLockup(logoHeight: 48)),
              const SizedBox(height: 22),
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: maxBodyHeight),
                child: SingleChildScrollView(
                  child: _PaneSwitch(
                    pane: pane,
                    roles: _RoleBody(key: const ValueKey('roles'), roles: roles, intro: motion, narrow: narrow),
                    body: body == null ? null : _AuthBody(key: ValueKey(pane), onBack: onBack, child: body!),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (motion == null) {
      return DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AuthLayout.panelRadius),
          boxShadow: const [BoxShadow(color: Color(0x1A111111), blurRadius: 32, offset: Offset(0, 12))],
        ),
        child: popup,
      );
    }
    return AnimatedBuilder(
      animation: motion,
      child: popup,
      builder: (context, child) {
        final card = Curves.easeOutCubic.transform(_span(motion.value, _Intro.card));
        final settle = Curves.easeOutCubic.transform(_span(motion.value, _Intro.settle));
        return Opacity(
          opacity: card,
          child: Transform.scale(
            scale: 0.985 + 0.015 * settle,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AuthLayout.panelRadius),
                boxShadow: [
                  BoxShadow(
                    color: ServeColors.ink.withValues(alpha: 0.10 * card),
                    blurRadius: 32,
                    offset: const Offset(0, 12),
                  ),
                ],
              ),
              child: child,
            ),
          ),
        );
      },
    );
  }
}

class _PaneSwitch extends StatelessWidget {
  const _PaneSwitch({required this.pane, required this.roles, required this.body});
  final _Pane pane;
  final Widget roles;
  final Widget? body;

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    final child = pane == _Pane.roles ? roles : body!;
    final switched = AnimatedSwitcher(
      duration: reduce ? Duration.zero : const Duration(milliseconds: 320),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      layoutBuilder: (current, previous) => Stack(alignment: Alignment.topCenter, children: [...previous, ?current]),
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 0.04), end: Offset.zero).animate(anim),
          child: child,
        ),
      ),
      child: child,
    );
    if (reduce) return switched;
    return AnimatedSize(
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeInOutCubic,
      alignment: Alignment.topCenter,
      child: switched,
    );
  }
}

class _RoleBody extends StatelessWidget {
  const _RoleBody({super.key, required this.roles, required this.intro, required this.narrow});
  final _Roles roles;
  final Animation<double>? intro;
  final bool narrow;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _Reveal(
        intro: intro,
        phase: _Intro.headline,
        child: const Align(alignment: Alignment.centerLeft, child: AuthAccent(width: 32)),
      ),
      const SizedBox(height: 12),
      _Reveal(
        intro: intro,
        phase: _Intro.headline,
        child: AuthHeadline(_headline, size: narrow ? 26 : 30),
      ),
      const SizedBox(height: 8),
      _Reveal(intro: intro, phase: _Intro.body, child: const AuthBody(_description)),
      const SizedBox(height: 22),
      _Reveal(
        intro: intro,
        phase: _Intro.cards[0],
        child: _RoleCard(
          icon: Icons.school_rounded,
          title: 'Student',
          subtitle: 'Order and track your food',
          primary: true,
          onTap: roles.onStudent,
        ),
      ),
      const SizedBox(height: 10),
      _Reveal(
        intro: intro,
        phase: _Intro.cards[1],
        child: _RoleCard(
          icon: Icons.storefront_rounded,
          title: 'Canteen Staff',
          subtitle: 'Manage orders and your canteen',
          onTap: roles.onStaff,
        ),
      ),
      const SizedBox(height: 10),
      _Reveal(
        intro: intro,
        phase: _Intro.cards[2],
        child: _RoleCard(
          icon: Icons.admin_panel_settings_rounded,
          title: 'Administrator',
          subtitle: 'Manage SERVE and oversee operations',
          onTap: roles.onAdmin,
        ),
      ),
    ],
  );
}

class _AuthBody extends StatelessWidget {
  const _AuthBody({super.key, required this.onBack, required this.child});
  final VoidCallback onBack;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Align(
        alignment: Alignment.centerLeft,
        child: BackButton(onPressed: onBack, color: ServeColors.ink),
      ),
      child,
    ],
  );
}

class _Reveal extends StatelessWidget {
  const _Reveal({required this.intro, required this.phase, required this.child});
  final Animation<double>? intro;
  final (double, double) phase;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final intro = this.intro;
    if (intro == null) return AuthEntrance(child: child);
    return AnimatedBuilder(
      animation: intro,
      child: child,
      builder: (context, child) {
        final t = Curves.easeOutCubic.transform(_span(intro.value, phase));
        return Opacity(
          opacity: t,
          child: Transform.translate(offset: Offset(0, 8 * (1 - t)), child: child),
        );
      },
    );
  }
}

class _SkipButton extends StatelessWidget {
  const _SkipButton({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Skip intro',
    excludeSemantics: true,
    child: TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: ServeColors.oliveInk,
        minimumSize: const Size(64, 44),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [Text('Skip'), SizedBox(width: 4), Icon(Icons.arrow_forward_rounded, size: 16)],
      ),
    ),
  );
}

class _Roles {
  const _Roles({required this.onStudent, required this.onStaff, required this.onAdmin});
  final VoidCallback onStudent;
  final VoidCallback onStaff;
  final VoidCallback onAdmin;
}

class _RoleCard extends StatefulWidget {
  const _RoleCard({required this.icon, required this.title, required this.subtitle, required this.onTap, this.primary = false});
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool primary;

  @override
  State<_RoleCard> createState() => _RoleCardState();
}

class _RoleCardState extends State<_RoleCard> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final primary = widget.primary;
    final fg = primary ? ServeColors.white : ServeColors.ink;
    final radius = BorderRadius.circular(ServeSpace.radiusCard);
    final onTint = ServeColors.white.withValues(alpha: 0.16);
    return AnimatedScale(
      scale: _pressed ? 0.985 : 1,
      duration: const Duration(milliseconds: 120),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          color: primary ? ServeColors.oliveStrong : ServeColors.white,
          borderRadius: radius,
          border: Border.all(color: primary ? ServeColors.oliveStrong : (_hovered ? ServeColors.olive : ServeColors.line)),
          boxShadow: _hovered ? const [BoxShadow(color: Color(0x0F111111), blurRadius: 16, offset: Offset(0, 6))] : const [],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: radius,
            onTap: widget.onTap,
            onHover: (v) => setState(() => _hovered = v),
            onHighlightChanged: (v) => setState(() => _pressed = v),
            hoverColor: primary ? ServeColors.white.withValues(alpha: 0.06) : Colors.transparent,
            splashColor: primary ? onTint : ServeColors.oliveTint,
            highlightColor: Colors.transparent,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
              child: Row(
                children: [
                  IconTile(
                    icon: widget.icon,
                    size: 48,
                    background: primary ? onTint : ServeColors.oliveTint,
                    color: primary ? ServeColors.white : ServeColors.oliveInk,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title,
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: fg, height: 1.25),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          widget.subtitle,
                          style: TextStyle(
                            fontSize: 13.5,
                            height: 1.35,
                            color: primary ? ServeColors.white.withValues(alpha: 0.88) : ServeColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  AnimatedSlide(
                    offset: Offset(_hovered ? 0.08 : 0, 0),
                    duration: const Duration(milliseconds: 180),
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(color: primary ? onTint : ServeColors.surfaceMuted, shape: BoxShape.circle),
                      child: Icon(Icons.arrow_forward_rounded, size: 18, color: primary ? ServeColors.white : ServeColors.muted),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
