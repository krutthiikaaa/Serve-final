import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';
import 'serve_logo.dart';

/// Logo and tagline at the top of the sign-in and registration screens.
class AuthBrand extends StatelessWidget {
  const AuthBrand({super.key});

  @override
  Widget build(BuildContext context) => const Row(
    children: [
      ServeLogo(height: 56),
      SizedBox(width: 14),
      Flexible(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ServeWordmark(size: 20),
            SizedBox(height: 6),
            Text(serveTagline, style: TextStyle(color: ServeColors.muted, fontSize: 13, letterSpacing: 0.8)),
          ],
        ),
      ),
    ],
  );
}
