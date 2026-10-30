import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../theme/serve_theme.dart';
import '../widgets/auth_layout.dart';
import '../widgets/sandwich_intro.dart';
import '../widgets/states.dart';
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

/// Students continue in the app; staff and admins are sent to their web portals.
///
/// Opening experience: the sandwich at the centre of the light-green field
/// bursts into its ingredients; those pieces travel into a centred popup and
/// become it. Later visits (e.g. back from sign-in) show the popup directly.
class RoleSelectionScreen extends StatefulWidget {
  const RoleSelectionScreen({super.key, required this.onStudent});
  final VoidCallback onStudent;

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

class _RoleSelectionScreenState extends State<RoleSelectionScreen> with TickerProviderStateMixin {
  late final bool _withIntro = !RoleSelectionScreen._introPlayed;
  late bool _playing = _withIntro;
  bool _started = false;
  bool _disposed = false;
  late final _intro = AnimationController(vsync: this, duration: RoleSelectionScreen.introDuration, value: _withIntro ? 0 : 1);
  late final _imageWait = AnimationController(vsync: this, duration: RoleSelectionScreen.maxImageWait);
  final _stageKey = GlobalKey();
  final _popupKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    if (_withIntro) {
      RoleSelectionScreen._introPlayed = true;
      _intro.addStatusListener(_onStatus);
    }
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
    super.dispose();
  }

  Future<void> _openPortal(String? url, String name) async {
    if (url == null) {
      showSnack(context, 'The $name link is not configured for this build.');
      return;
    }
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok && mounted) showSnack(context, 'Could not open the $name.');
  }

  Rect? _popupRect() {
    final popup = _popupKey.currentContext?.findRenderObject();
    final stage = _stageKey.currentContext?.findRenderObject();
    if (popup is! RenderBox || stage is! RenderBox || !popup.hasSize || !popup.attached) return null;
    return popup.localToGlobal(Offset.zero, ancestor: stage) & popup.size;
  }

  @override
  Widget build(BuildContext context) {
    final config = context.read<AppConfig>();
    final roles = _Roles(
      onStudent: widget.onStudent,
      onStaff: () => _openPortal(config.staffDashboardUrl, 'staff dashboard'),
      onAdmin: () => _openPortal(config.adminPortalUrl, 'admin portal'),
    );
    final intro = _withIntro ? _intro : null;
    return Scaffold(
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
                            child: _RolePopup(roles: roles, intro: intro),
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
    );
  }
}

/// The centred role-selection card. During the intro its paper surface and
/// contents grow in as the sandwich pieces arrive to build it.
class _RolePopup extends StatelessWidget {
  const _RolePopup({required this.roles, required this.intro});
  final _Roles roles;
  final Animation<double>? intro;

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
              _Reveal(
                intro: motion,
                phase: _Intro.headline,
                child: const Align(alignment: Alignment.centerLeft, child: AuthAccent(width: 32)),
              ),
              const SizedBox(height: 12),
              _Reveal(
                intro: motion,
                phase: _Intro.headline,
                child: AuthHeadline(_headline, size: narrow ? 26 : 30),
              ),
              const SizedBox(height: 8),
              _Reveal(intro: motion, phase: _Intro.body, child: const AuthBody(_description)),
              const SizedBox(height: 22),
              _Reveal(
                intro: motion,
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
                intro: motion,
                phase: _Intro.cards[1],
                child: _RoleCard(
                  icon: Icons.storefront_rounded,
                  title: 'Canteen Staff',
                  subtitle: 'Manage orders and your canteen',
                  trailing: Icons.open_in_new_rounded,
                  onTap: roles.onStaff,
                ),
              ),
              const SizedBox(height: 10),
              _Reveal(
                intro: motion,
                phase: _Intro.cards[2],
                child: _RoleCard(
                  icon: Icons.admin_panel_settings_rounded,
                  title: 'Administrator',
                  subtitle: 'Manage SERVE and oversee operations',
                  trailing: Icons.open_in_new_rounded,
                  onTap: roles.onAdmin,
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
  const _RoleCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.primary = false,
    this.trailing = Icons.arrow_forward_rounded,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool primary;
  final IconData trailing;

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
                      child: Icon(widget.trailing, size: 18, color: primary ? ServeColors.white : ServeColors.muted),
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
