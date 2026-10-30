import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

/// The official SERVE tagline. Used on the role selection and sign-in screens
/// only.
const serveTagline = 'Order. Track. Collect.';

/// The official SERVE logo (`assets/images/serve_logo.png`, transparent).
/// Always shown at its own proportions on a light surface; never boxed,
/// cropped or recoloured.
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
        filterQuality: FilterQuality.medium,
        excludeFromSemantics: true,
      ),
    );
  }
}

/// The "SERVE" name set in type next to (or under) the logo.
class ServeWordmark extends StatelessWidget {
  const ServeWordmark({super.key, this.size = 18});
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Text(
      'SERVE',
      style: TextStyle(fontSize: size, fontWeight: FontWeight.w600, letterSpacing: size * 0.22, height: 1, color: ServeColors.ink),
    ),
  );
}

/// Logo + name, side by side: the compact brand mark used in headers.
class ServeLockup extends StatelessWidget {
  const ServeLockup({super.key, this.logoHeight = 34});
  final double logoHeight;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'SERVE',
    child: ExcludeSemantics(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ServeLogo(height: logoHeight),
          SizedBox(width: logoHeight * 0.28),
          ServeWordmark(size: logoHeight * 0.5),
        ],
      ),
    ),
  );
}
