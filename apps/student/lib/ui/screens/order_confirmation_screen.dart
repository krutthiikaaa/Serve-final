import 'package:flutter/material.dart';

import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import 'order_tracking_screen.dart';

class OrderConfirmationScreen extends StatelessWidget {
  const OrderConfirmationScreen({super.key, required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0.6, end: 1),
                duration: const Duration(milliseconds: 500),
                curve: Curves.elasticOut,
                builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: const BoxDecoration(color: ServeColors.olive, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, color: ServeColors.white, size: 56),
                ),
              ),
              const SizedBox(height: 24),
              Text('Payment confirmed', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 6),
              const Text('The canteen has your order.', style: TextStyle(color: ServeColors.muted, fontSize: 16)),
              const SizedBox(height: 28),
              const Text(
                'YOUR ORDER NUMBER',
                style: TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w800, letterSpacing: 1.2, fontSize: 12),
              ),
              const SizedBox(height: 4),
              Semantics(
                label: 'Order number ${order.orderNumber}',
                excludeSemantics: true,
                child: Text(order.orderNumber, style: const TextStyle(fontSize: 52, fontWeight: FontWeight.w900, letterSpacing: 2)),
              ),
              const SizedBox(height: 8),
              Text(
                'Collect at ${order.canteen.name}',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              FilledButton(
                onPressed: () => Navigator.of(context).pushReplacement(serveRoute(OrderTrackingScreen(orderId: order.id))),
                child: const Text('Track order'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: () => backToTab(context, HomeTabs.home), child: const Text('Back to home')),
            ],
          ),
        ),
      ),
    );
  }
}
