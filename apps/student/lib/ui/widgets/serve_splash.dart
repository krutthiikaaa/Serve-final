import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import 'serve_logo.dart';

double _span(double t, (double, double) phase) => ((t - phase.$1) / (phase.$2 - phase.$1)).clamp(0.0, 1.0);

/// Premium launch splash: official SERVE logo, wordmark, and tagline on the
/// same warm olive field as role selection. Driven by one parent controller.
class ServeSplashStage extends StatelessWidget {
  const ServeSplashStage({super.key, required this.progress});
  final Animation<double> progress;

  static const logoAsset = 'assets/images/serve_logo.png';

  /// Splash fades as the role card comes in.
  static const fadeOut = (0.74, 0.94);
  static const glow = (0.04, 0.26);
  static const logo = (0.10, 0.34);
  static const wordmark = (0.28, 0.48);
  static const tagline = (0.42, 0.60);

  static Future<void> precache(BuildContext context) => precacheImage(const AssetImage(logoAsset), context, onError: (_, _) {});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: progress,
      builder: (context, _) {
        final t = progress.value;
        final out = 1 - Curves.easeInOutCubic.transform(_span(t, fadeOut));
        final glowT = Curves.easeOutCubic.transform(_span(t, glow));
        final logoT = Curves.easeOutCubic.transform(_span(t, logo));
        final wordT = Curves.easeOutCubic.transform(_span(t, wordmark));
        final lineT = Curves.easeOutCubic.transform(_span(t, tagline));
        final float = t < fadeOut.$1 && logoT > 0 ? math.sin((t - logo.$1) * math.pi * 1.4) * 3.0 * logoT : 0.0;
        final shortest = MediaQuery.sizeOf(context).shortestSide;
        final logoH = (shortest * 0.20).clamp(72.0, 112.0);
        return Opacity(
          opacity: out,
          child: ColoredBox(
            color: Colors.transparent,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 360),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: logoH * 2.4,
                      height: logoH * 2.4,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          CustomPaint(
                            size: Size(logoH * 2.4, logoH * 2.4),
                            painter: _SplashAuraPainter(progress: glowT, pulse: logoT),
                          ),
                          Transform.translate(
                            offset: Offset(0, float),
                            child: Opacity(
                              opacity: logoT,
                              child: Transform.scale(
                                scale: 0.88 + 0.12 * logoT,
                                child: ServeLogo(height: logoH),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Opacity(
                      opacity: wordT,
                      child: Text(
                        'SERVE',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: (logoH * 0.22).clamp(18.0, 24.0),
                          fontWeight: FontWeight.w600,
                          letterSpacing: 6 + 6 * wordT,
                          height: 1,
                          color: ServeColors.ink,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Opacity(
                      opacity: lineT,
                      child: const Text(
                        serveTagline,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: ServeColors.muted, fontSize: 14, letterSpacing: 1.4, fontWeight: FontWeight.w500),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _SplashAuraPainter extends CustomPainter {
  const _SplashAuraPainter({required this.progress, required this.pulse});
  final double progress;
  final double pulse;

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final c = size.center(Offset.zero);
    final maxR = size.shortestSide * 0.46;
    final glow = Paint()
      ..color = ServeColors.olive.withValues(alpha: 0.16 * progress)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 18);
    canvas.drawCircle(c, maxR * (0.55 + 0.45 * progress), glow);

    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = ServeColors.olive.withValues(alpha: 0.22 * progress);
    canvas.drawCircle(c, maxR * (0.42 + 0.38 * progress), ring);

    final inner = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = ServeColors.oliveDark.withValues(alpha: 0.12 * pulse);
    if (pulse > 0) canvas.drawCircle(c, maxR * 0.36, inner);

    final dot = Paint()..color = ServeColors.olive.withValues(alpha: 0.18 * pulse);
    if (pulse > 0) {
      const dots = [Offset(0.78, -0.18), Offset(-0.72, 0.22), Offset(0.58, 0.62), Offset(-0.52, -0.58)];
      for (final d in dots) {
        canvas.drawCircle(c + Offset(d.dx * maxR, d.dy * maxR), 2.4, dot);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SplashAuraPainter old) => old.progress != progress || old.pulse != pulse;
}
