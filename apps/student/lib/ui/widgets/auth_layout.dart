import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import 'serve_logo.dart';

/// Layout shared by the signed-out screens (role selection and sign-in), so
/// both read as one flow: the same brand panel, breakpoints and motion.
abstract final class AuthLayout {
  /// From here the content sits in a centred column (tablet).
  static const cardBreakpoint = 600.0;

  /// From here the brand panel sits beside the content (desktop).
  static const splitBreakpoint = 960.0;

  static const maxWidth = 1240.0;
  static const panelMinHeight = 680.0;
  static const panelRadius = 24.0;
}

/// Desktop composition: brand panel on the left, [side] centred on the right.
class AuthSplitLayout extends StatelessWidget {
  const AuthSplitLayout({super.key, required this.constraints, required this.panel, required this.side, this.top = 0});
  final BoxConstraints constraints;
  final Widget panel;
  final Widget side;

  /// Space above the panel, for screens without an app bar.
  final double top;

  @override
  Widget build(BuildContext context) {
    // At least the viewport tall; taller (and scrolling) when the content
    // needs it, e.g. with large text.
    final minHeight = math.max(constraints.maxHeight, AuthLayout.panelMinHeight);
    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: AuthLayout.maxWidth, minHeight: minHeight),
          child: Padding(
            padding: EdgeInsets.fromLTRB(24, top, 24, 24),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 11, child: AuthEntrance(child: panel)),
                  Expanded(
                    flex: 10,
                    child: Center(
                      child: Padding(padding: const EdgeInsets.all(32), child: side),
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

/// The olive-tinted brand panel: logo lockup, headline, supporting text and a
/// [footer]. With [bleedFooter] the footer runs to the panel's bottom edge.
class AuthBrandPanel extends StatelessWidget {
  const AuthBrandPanel({super.key, required this.headline, required this.body, required this.footer, this.bleedFooter = false});
  final String headline;
  final String body;
  final Widget footer;
  final bool bleedFooter;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      padding: EdgeInsets.fromLTRB(56, 48, 56, bleedFooter ? 0 : 44),
      decoration: BoxDecoration(color: ServeColors.oliveTint, borderRadius: BorderRadius.circular(AuthLayout.panelRadius)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AuthLockup(logoHeight: 64),
          const SizedBox(height: 24),
          const Spacer(),
          const AuthAccent(),
          const SizedBox(height: 20),
          AuthHeadline(headline, size: 44),
          const SizedBox(height: 18),
          ConstrainedBox(constraints: const BoxConstraints(maxWidth: 460), child: AuthBody(body, size: 17)),
          const SizedBox(height: 24),
          const Spacer(flex: 2),
          footer,
        ],
      ),
    );
  }
}

/// Logo with the wordmark and tagline beside it.
class AuthLockup extends StatelessWidget {
  const AuthLockup({super.key, this.logoHeight = 64});
  final double logoHeight;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      ServeLogo(height: logoHeight),
      SizedBox(width: logoHeight * 0.25),
      Flexible(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ServeWordmark(size: logoHeight * 0.34),
            SizedBox(height: logoHeight * 0.12),
            Text(
              serveTagline,
              style: TextStyle(color: ServeColors.muted, fontSize: logoHeight < 60 ? 12 : 13, letterSpacing: 1.1),
            ),
          ],
        ),
      ),
    ],
  );
}

/// Logo, name and tagline stacked and centred (phones and tablets).
class AuthCompactBrand extends StatelessWidget {
  const AuthCompactBrand({super.key});

  @override
  Widget build(BuildContext context) => const Column(
    children: [
      ServeLogo(height: 72),
      SizedBox(height: 14),
      ServeWordmark(size: 22),
      SizedBox(height: 8),
      Text(
        serveTagline,
        textAlign: TextAlign.center,
        style: TextStyle(color: ServeColors.muted, fontSize: 13, letterSpacing: 1.1),
      ),
    ],
  );
}

/// The short orange rule above a headline.
class AuthAccent extends StatelessWidget {
  const AuthAccent({super.key, this.width = 36});
  final double width;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: 4,
    decoration: BoxDecoration(color: ServeColors.orange, borderRadius: BorderRadius.circular(2)),
  );
}

class AuthHeadline extends StatelessWidget {
  const AuthHeadline(this.text, {super.key, required this.size});
  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Text(
      text,
      style: Theme.of(context).textTheme.displaySmall
          ?.copyWith(fontSize: size, fontWeight: FontWeight.w800, letterSpacing: -size * 0.027, height: 1.1, color: ServeColors.ink),
    ),
  );
}

class AuthBody extends StatelessWidget {
  const AuthBody(this.text, {super.key, this.size = 15});
  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: ServeColors.muted, fontSize: size, height: 1.55),
  );
}

/// A short fade and rise when content appears, optionally after [delay];
/// skipped when the platform asks for reduced motion.
class AuthEntrance extends StatelessWidget {
  const AuthEntrance({super.key, required this.child, this.delay = Duration.zero});
  final Widget child;
  final Duration delay;

  static const _duration = Duration(milliseconds: 420);

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final total = _duration + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: reduce ? 1 : 0, end: 1),
      duration: total,
      curve: Interval(delay.inMilliseconds / total.inMilliseconds, 1, curve: Curves.easeOutCubic),
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, 12 * (1 - t)), child: child),
      ),
    );
  }
}
