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
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(20)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: foreground),
            const SizedBox(width: 5),
            Flexible(
              fit: FlexFit.loose,
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: 12, height: 1.2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Whether a canteen is taking orders, with its hours when it is.
class CanteenStatusLabel extends StatelessWidget {
  const CanteenStatusLabel({super.key, required this.canteen});
  final Canteen canteen;

  @override
  Widget build(BuildContext context) {
    // With backend availability (Day/Night aware) the state is shown by
    // [ServiceAvailabilityPills]; only the hours are added here.
    if (canteen.availability != null) {
      final hours = canteen.openingHours;
      if (hours == null) return const SizedBox.shrink();
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.schedule_rounded, size: 14, color: ServeColors.muted),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              hours,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: ServeColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
    }
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
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.schedule_rounded, size: 14, color: ServeColors.muted),
              const SizedBox(width: 4),
              Flexible(
                fit: FlexFit.loose,
                child: Text(
                  hours,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: ServeColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
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

/// Day / Night identification shown wherever a canteen is named.
class CanteenTypeChip extends StatelessWidget {
  const CanteenTypeChip({super.key, required this.type, this.dense = false});
  final ServicePeriod type;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final day = type == ServicePeriod.day;
    return Semantics(
      label: '${type.label} canteen',
      excludeSemantics: true,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 2 : 4),
        decoration: BoxDecoration(
          color: ServeColors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: ServeColors.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              day ? Icons.wb_sunny_outlined : Icons.nightlight_round,
              size: dense ? 12 : 14,
              color: day ? ServeColors.orangeInk : ServeColors.oliveInk,
            ),
            const SizedBox(width: 4),
            Text(
              type.label,
              style: TextStyle(fontSize: dense ? 11 : 12, fontWeight: FontWeight.w700, color: ServeColors.ink),
            ),
          ],
        ),
      ),
    );
  }
}

/// Switches between the Day and Night canteen of the student's service area.
/// Only one of them takes orders at a time (decided by the backend); the other
/// can still be browsed.
class ServiceSwitch extends StatelessWidget {
  const ServiceSwitch({super.key, required this.service, required this.selectedId, required this.onSelect});
  final StudentService service;
  final String? selectedId;
  final ValueChanged<Canteen> onSelect;

  @override
  Widget build(BuildContext context) {
    final options = [
      for (final type in ServicePeriod.values)
        if (service.ofType(type) != null) service.ofType(type)!,
    ];
    if (options.length < 2) return const SizedBox.shrink();
    return Semantics(
      label: 'Day or Night canteen',
      container: true,
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: ServeColors.surfaceMuted, borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            for (final canteen in options)
              Expanded(
                child: _ServiceOption(canteen: canteen, selected: canteen.id == selectedId, onTap: () => onSelect(canteen)),
              ),
          ],
        ),
      ),
    );
  }
}

class _ServiceOption extends StatelessWidget {
  const _ServiceOption({required this.canteen, required this.selected, required this.onTap});
  final Canteen canteen;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final open = canteen.availability?.state == AvailabilityState.open;
    final fg = selected ? ServeColors.white : ServeColors.ink;
    return Semantics(
      button: true,
      selected: selected,
      label: '${canteen.type.canteenLabel}, ${canteen.availability?.label ?? ''}',
      excludeSemantics: true,
      child: Material(
        color: selected ? ServeColors.oliveStrong : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          key: Key('service-${canteen.type.apiValue}'),
          onTap: selected ? null : onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
            child: Column(
              children: [
                Text(
                  canteen.type.label.toUpperCase(),
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: fg, letterSpacing: 0.4),
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.circle, size: 7, color: open ? (selected ? ServeColors.white : ServeColors.oliveInk) : ServeColors.muted),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        canteen.availability?.label ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: selected ? ServeColors.white.withValues(alpha: 0.9) : ServeColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The canteen's own type and whether it can take an order right now.
class ServiceAvailabilityPills extends StatelessWidget {
  const ServiceAvailabilityPills({super.key, required this.canteen});
  final Canteen canteen;

  @override
  Widget build(BuildContext context) {
    final a = canteen.availability;
    final open = a == null ? canteen.availabilityFor(canteen.type) == ServiceAvailability.open : a.state == AvailabilityState.open;
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        CanteenTypeChip(type: canteen.type),
        StatusPill(
          label: a?.label ?? canteen.availabilityLabel(canteen.type),
          icon: open ? Icons.circle : Icons.schedule_rounded,
          foreground: open ? ServeColors.oliveInk : ServeColors.muted,
          background: open ? ServeColors.oliveTint : ServeColors.surfaceMuted,
        ),
      ],
    );
  }
}
