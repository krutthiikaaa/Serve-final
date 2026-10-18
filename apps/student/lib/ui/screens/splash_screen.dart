import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import '../widgets/serve_logo.dart';

/// Logo fades and settles in, then the name and the tagline follow. Shown while
/// a saved session is restored.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..forward();

  Animation<double> _interval(double begin, double end) => CurvedAnimation(
    parent: _controller,
    curve: Interval(begin, end, curve: Curves.easeOutCubic),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final logo = _interval(0, 0.55);
    final name = _interval(0.3, 0.75);
    final tagline = _interval(0.5, 1);
    return Scaffold(
      backgroundColor: ServeColors.paper,
      body: Center(
        child: Semantics(
          label: 'SERVE. $serveTagline',
          child: ExcludeSemantics(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FadeTransition(
                  opacity: logo,
                  child: ScaleTransition(scale: Tween(begin: 0.92, end: 1.0).animate(logo), child: const ServeLogo(height: 120)),
                ),
                const SizedBox(height: 28),
                FadeTransition(opacity: name, child: const ServeWordmark(size: 34)),
                const SizedBox(height: 14),
                FadeTransition(
                  opacity: tagline,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(tagline),
                    child: const Text(serveTagline, style: TextStyle(color: ServeColors.muted, fontSize: 16, letterSpacing: 1.4)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
