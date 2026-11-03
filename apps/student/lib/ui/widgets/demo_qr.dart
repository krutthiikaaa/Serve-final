import 'package:flutter/material.dart';

import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';

/// QR-style DEMO placeholder. Encodes [DemoQr.payload], never a `upi://` URI.
class DemoQrView extends StatelessWidget {
  const DemoQrView({super.key, required this.demo, this.size = 196});
  final DemoQr demo;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          label: demo.warning,
          child: Container(
            width: size,
            height: size,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: ServeColors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: ServeColors.orangeInk.withValues(alpha: 0.35)),
            ),
            child: CustomPaint(painter: _DemoQrPainter(demo.payload)),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          demo.warning,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w800, color: ServeColors.orangeInk),
        ),
        const SizedBox(height: 4),
        const Text(
          'This is a placeholder for testing. Scanning it will not transfer money.',
          textAlign: TextAlign.center,
          style: TextStyle(color: ServeColors.muted, height: 1.35),
        ),
      ],
    );
  }
}

class _DemoQrPainter extends CustomPainter {
  _DemoQrPainter(this.payload);
  final String payload;

  @override
  void paint(Canvas canvas, Size size) {
    const n = 21;
    final cell = size.width / n;
    final fill = Paint()..color = ServeColors.ink;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (!_on(x, y, n)) continue;
        canvas.drawRect(Rect.fromLTWH(x * cell, y * cell, cell, cell), fill);
      }
    }
  }

  bool _on(int x, int y, int n) {
    if (_finder(x, y, 0, 0) || _finder(x, y, n - 7, 0) || _finder(x, y, 0, n - 7)) return true;
    final hash = Object.hash(payload, x, y);
    return hash.isEven;
  }

  bool _finder(int x, int y, int ox, int oy) {
    final dx = x - ox;
    final dy = y - oy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
    final ring = [dx, dy, 6 - dx, 6 - dy].reduce((a, b) => a < b ? a : b);
    return ring == 0 || ring >= 2;
  }

  @override
  bool shouldRepaint(covariant _DemoQrPainter oldDelegate) => oldDelegate.payload != payload;
}
