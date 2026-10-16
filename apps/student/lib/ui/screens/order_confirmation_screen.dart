import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/serve_logo.dart';
import 'order_tracking_screen.dart';

class OrderConfirmationScreen extends StatelessWidget {
  const OrderConfirmationScreen({super.key, required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Center(child: ServeLogo(height: 44)),
                    const Spacer(),
                    Center(
                      child: TweenAnimationBuilder<double>(
                        tween: Tween(begin: 0, end: 1),
                        duration: const Duration(milliseconds: 450),
                        curve: Curves.easeOutBack,
                        builder: (context, t, child) => Opacity(
                          opacity: t.clamp(0, 1),
                          child: Transform.scale(scale: 0.7 + 0.3 * t, child: child),
                        ),
                        child: Container(
                          width: 84,
                          height: 84,
                          decoration: const BoxDecoration(color: ServeColors.oliveStrong, shape: BoxShape.circle),
                          child: const Icon(Icons.check_rounded, color: ServeColors.white, size: 48),
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),
                    Text('Payment confirmed', textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 6),
                    Text(
                      'The canteen has your order.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted),
                    ),
                    const SizedBox(height: 26),
                    Card(
                      semanticContainer: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
                        child: Column(
                          children: [
                            Text('YOUR ORDER NUMBER', style: theme.textTheme.labelSmall?.copyWith(color: ServeColors.muted)),
                            const SizedBox(height: 4),
                            Semantics(
                              label: 'Order number ${order.orderNumber}',
                              excludeSemantics: true,
                              child: Text(
                                order.orderNumber,
                                style: const TextStyle(fontSize: 46, fontWeight: FontWeight.w800, letterSpacing: 2),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Collect at ${order.canteen.name}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Divider()),
                            Text(
                              '${order.itemCount} ${order.itemCount == 1 ? 'item' : 'items'} · ${formatRupees(order.totalPaise)} · paid',
                              style: const TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: () => Navigator.of(context).pushReplacement(serveRoute(OrderTrackingScreen(orderId: order.id))),
                      child: const Text('Track order'),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton(onPressed: () => backToTab(context, HomeTabs.home), child: const Text('Back to home')),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
