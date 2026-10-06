import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import '../widgets/serve_logo.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ServeColors.paper,
      body: Center(
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 600),
          curve: Curves.easeOutCubic,
          builder: (context, t, child) => Opacity(
            opacity: t,
            child: Transform.translate(offset: Offset(0, 12 * (1 - t)), child: child),
          ),
          child: const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ServeLogo(height: 72),
              SizedBox(height: 14),
              Text(
                'Order. Track. Collect.',
                style: TextStyle(color: ServeColors.muted, fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: 0.3),
              ),
              SizedBox(height: 40),
              SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: ServeColors.olive)),
            ],
          ),
        ),
      ),
    );
  }
}
