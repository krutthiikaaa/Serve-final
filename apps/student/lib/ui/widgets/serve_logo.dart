import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// Slot for the official SERVE logo (`assets/images/serve_logo.png`, a
/// transparent PNG supplied by the project owner). Until that file exists a
/// plain text wordmark is shown — the logo is never redrawn or boxed.
class ServeLogo extends StatelessWidget {
  const ServeLogo({super.key, this.height = 32});
  final double height;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'SERVE',
      image: true,
      child: Image.asset(
        'assets/images/serve_logo.png',
        height: height,
        fit: BoxFit.contain,
        excludeFromSemantics: true,
        errorBuilder: (context, error, stack) => ExcludeSemantics(
          child: Text(
            'SERVE',
            style: TextStyle(fontSize: height * 0.62, fontWeight: FontWeight.w900, letterSpacing: height * 0.12, color: ServeColors.ink),
          ),
        ),
      ),
    );
  }
}
