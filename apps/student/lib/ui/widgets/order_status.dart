import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';
import 'surface.dart';

String orderStatusLabel(OrderStatus status) => switch (status) {
  OrderStatus.placed => 'Awaiting payment',
  OrderStatus.paymentConfirmed => 'Payment confirmed',
  OrderStatus.preparing => 'Preparing',
  OrderStatus.ready => 'Ready for pickup',
  OrderStatus.collected => 'Collected',
  OrderStatus.cancelled => 'Cancelled',
};

String orderStatusHeadline(OrderStatus status) => switch (status) {
  OrderStatus.placed => 'Complete your payment',
  OrderStatus.paymentConfirmed => 'Order received',
  OrderStatus.preparing => 'Your food is being prepared',
  OrderStatus.ready => 'Ready for pickup',
  OrderStatus.collected => 'Collected — enjoy!',
  OrderStatus.cancelled => 'Order cancelled',
};

({Color bg, Color fg, IconData icon}) orderStatusStyle(OrderStatus status) => switch (status) {
  OrderStatus.placed => (bg: ServeColors.surfaceMuted, fg: ServeColors.muted, icon: Icons.schedule_rounded),
  OrderStatus.paymentConfirmed => (bg: ServeColors.orangeTint, fg: ServeColors.orangeInk, icon: Icons.receipt_long_rounded),
  OrderStatus.preparing => (bg: const Color(0xFFFFF4D6), fg: const Color(0xFF6E5100), icon: Icons.local_fire_department_rounded),
  OrderStatus.ready => (bg: ServeColors.oliveTint, fg: ServeColors.oliveInk, icon: Icons.shopping_bag_rounded),
  OrderStatus.collected => (bg: ServeColors.surfaceMuted, fg: ServeColors.muted, icon: Icons.check_circle_rounded),
  OrderStatus.cancelled => (bg: ServeColors.dangerTint, fg: ServeColors.danger, icon: Icons.cancel_rounded),
};

/// Status is conveyed by icon + text, never colour alone.
class OrderStatusChip extends StatelessWidget {
  const OrderStatusChip({super.key, required this.status});
  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    final s = orderStatusStyle(status);
    return StatusPill(label: orderStatusLabel(status), icon: s.icon, foreground: s.fg, background: s.bg);
  }
}

/// Five-segment progress (placed → collected) for compact order cards.
class OrderProgressBar extends StatelessWidget {
  const OrderProgressBar({super.key, required this.status, this.onDark = false});
  final OrderStatus status;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final reached = OrderTimeline.steps.indexOf(status);
    return ExcludeSemantics(
      child: Row(
        children: [
          for (var i = 0; i < OrderTimeline.steps.length; i++) ...[
            if (i > 0) const SizedBox(width: 4),
            Expanded(
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                height: 5,
                decoration: BoxDecoration(
                  color: i <= reached
                      ? (onDark ? ServeColors.white : ServeColors.olive)
                      : (onDark ? ServeColors.white.withValues(alpha: 0.3) : ServeColors.line),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// PLACED → PAYMENT CONFIRMED → PREPARING → READY → COLLECTED, with times.
class OrderTimeline extends StatelessWidget {
  const OrderTimeline({super.key, required this.order});
  final StudentOrder order;

  static const steps = [OrderStatus.placed, OrderStatus.paymentConfirmed, OrderStatus.preparing, OrderStatus.ready, OrderStatus.collected];

  static String stepLabel(OrderStatus s) => switch (s) {
    OrderStatus.placed => 'Order placed',
    OrderStatus.paymentConfirmed => 'Payment confirmed',
    OrderStatus.preparing => 'Preparing',
    OrderStatus.ready => 'Ready for pickup',
    OrderStatus.collected => 'Collected',
    OrderStatus.cancelled => 'Cancelled',
  };

  @override
  Widget build(BuildContext context) {
    final cancelled = order.status == OrderStatus.cancelled;
    final visible = cancelled ? [...steps.where((s) => order.reachedAt(s) != null), OrderStatus.cancelled] : steps;
    final currentIndex = cancelled ? visible.length - 1 : steps.indexOf(order.status);
    return Column(
      children: [
        for (var i = 0; i < visible.length; i++)
          _TimelineRow(
            label: stepLabel(visible[i]),
            at: order.reachedAt(visible[i]),
            reached: i <= currentIndex,
            current: i == currentIndex,
            danger: visible[i] == OrderStatus.cancelled,
            isLast: i == visible.length - 1,
          ),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.label,
    required this.at,
    required this.reached,
    required this.current,
    required this.danger,
    required this.isLast,
  });
  final String label;
  final DateTime? at;
  final bool reached;
  final bool current;
  final bool danger;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final color = danger ? ServeColors.danger : (reached ? ServeColors.oliveStrong : ServeColors.line);
    return Semantics(
      label: '$label${reached ? ', done' : ', pending'}${at != null ? ' at ${formatTime(at!)}' : ''}',
      excludeSemantics: true,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 28,
              child: Column(
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: current ? 22 : 16,
                    height: current ? 22 : 16,
                    margin: EdgeInsets.only(top: current ? 0 : 3),
                    decoration: BoxDecoration(
                      color: reached ? color : ServeColors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: color, width: 2),
                      boxShadow: current ? [BoxShadow(color: color.withValues(alpha: 0.2), blurRadius: 0, spreadRadius: 5)] : null,
                    ),
                    child: reached
                        ? Icon(danger ? Icons.close_rounded : Icons.check_rounded, size: current ? 14 : 10, color: ServeColors.white)
                        : null,
                  ),
                  if (!isLast) Expanded(child: Container(width: 2, color: reached ? ServeColors.oliveStrong : ServeColors.line)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 22),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                          color: reached ? ServeColors.ink : ServeColors.muted,
                          fontSize: current ? 16 : 15,
                        ),
                      ),
                    ),
                    if (at != null) Text(formatTime(at!), style: const TextStyle(color: ServeColors.muted, fontSize: 13)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
