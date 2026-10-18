import 'package:flutter/material.dart';

import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';

/// Section title with an optional action on the right.
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.subtitle, this.trailing});
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(header: true, child: Text(title, style: theme.textTheme.titleLarge)),
              if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: theme.textTheme.bodySmall)],
            ],
          ),
        ),
        ?trailing,
      ],
    );
  }
}

/// Small rounded tile holding an icon (canteen, payment, settings rows).
class IconTile extends StatelessWidget {
  const IconTile({
    super.key,
    required this.icon,
    this.size = 44,
    this.background = ServeColors.oliveTint,
    this.color = ServeColors.oliveInk,
  });
  final IconData icon;
  final double size;
  final Color background;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(size * 0.3)),
    child: Icon(icon, color: color, size: size * 0.5),
  );
}

/// Pill with an icon and a label; status is never shown by colour alone.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.icon, required this.foreground, required this.background});
  final String label;
  final IconData icon;
  final Color foreground;
  final Color background;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(20)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: foreground),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            label,
            style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: 12, height: 1.2),
          ),
        ),
      ],
    ),
  );
}

/// Whether a canteen is taking orders, with its hours when it is.
class CanteenStatusLabel extends StatelessWidget {
  const CanteenStatusLabel({super.key, required this.canteen});
  final Canteen canteen;

  @override
  Widget build(BuildContext context) {
    final pill = switch (canteen.status) {
      CanteenStatus.acceptingOrders => const StatusPill(
        label: 'Accepting orders',
        icon: Icons.circle,
        foreground: ServeColors.oliveInk,
        background: ServeColors.oliveTint,
      ),
      CanteenStatus.paused => const StatusPill(
        label: 'Not accepting orders right now',
        icon: Icons.pause_circle_filled_rounded,
        foreground: ServeColors.orangeInk,
        background: ServeColors.orangeTint,
      ),
      CanteenStatus.inactive => const StatusPill(
        label: 'Closed',
        icon: Icons.do_not_disturb_on_rounded,
        foreground: ServeColors.muted,
        background: ServeColors.surfaceMuted,
      ),
    };
    final hours = canteen.openingHours;
    if (!canteen.acceptingOrders || hours == null) return pill;
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        pill,
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.schedule_rounded, size: 14, color: ServeColors.muted),
            const SizedBox(width: 4),
            Text(
              hours,
              style: const TextStyle(color: ServeColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ],
    );
  }
}

/// Label / amount row used in cart, checkout and order summaries.
class SummaryRow extends StatelessWidget {
  const SummaryRow({super.key, required this.label, required this.value, this.emphasis = false});
  final String label;
  final String value;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final style = emphasis
        ? const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)
        : const TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w500);
    return Row(
      children: [
        Expanded(
          child: Text(label, style: emphasis ? const TextStyle(fontSize: 16, fontWeight: FontWeight.w700) : style),
        ),
        Text(value, style: emphasis ? style.copyWith(fontSize: 22) : style.copyWith(color: ServeColors.ink)),
      ],
    );
  }
}
