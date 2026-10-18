import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';

class CanteenSelectionScreen extends StatefulWidget {
  const CanteenSelectionScreen({super.key});

  @override
  State<CanteenSelectionScreen> createState() => _CanteenSelectionScreenState();
}

class _CanteenSelectionScreenState extends State<CanteenSelectionScreen> {
  List<Canteen>? _canteens;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final canteens = await context.read<ServeApi>().canteens();
      if (mounted) setState(() => _canteens = canteens);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _choose(Canteen canteen) async {
    final selection = context.read<CanteenSelection>();
    final cart = context.read<CartController>();
    if (canteen.id == selection.id) {
      Navigator.of(context).pop();
      return;
    }
    if (cart.conflictsWith(canteen.id)) {
      if (!await confirmSwitchCanteen(context)) return;
      cart.clear();
    }
    selection.select(canteen.id, canteen.name);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final selectedId = context.watch<CanteenSelection>().id;
    final canteens = _canteens;
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a canteen')),
      body: canteens == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const SkeletonList(label: 'Loading canteens', header: false))
          : canteens.isEmpty
          ? const EmptyView(icon: Icons.storefront_outlined, title: 'No canteens are open right now')
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
              itemCount: canteens.length + 1,
              separatorBuilder: (_, i) => SizedBox(height: i == 0 ? 14 : 10),
              itemBuilder: (context, i) {
                if (i == 0) {
                  return Text(
                    'Your hostel decides your default canteen. You can order from any canteen that is accepting orders.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: ServeColors.muted),
                  );
                }
                final c = canteens[i - 1];
                return _CanteenOption(canteen: c, selected: c.id == selectedId, onTap: () => _choose(c));
              },
            ),
    );
  }
}

class _CanteenOption extends StatelessWidget {
  const _CanteenOption({required this.canteen, required this.selected, required this.onTap});
  final Canteen canteen;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      selected: selected,
      child: Card(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
          side: BorderSide(color: selected ? ServeColors.oliveStrong : ServeColors.line, width: selected ? 2 : 1),
        ),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IconTile(
                  icon: Icons.storefront_rounded,
                  background: selected ? ServeColors.oliveStrong : ServeColors.oliveTint,
                  color: selected ? ServeColors.white : ServeColors.oliveInk,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(canteen.name, style: theme.textTheme.titleMedium),
                      if (canteen.location != null) ...[
                        const SizedBox(height: 3),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Padding(
                              padding: EdgeInsets.only(top: 2),
                              child: Icon(Icons.place_outlined, size: 15, color: ServeColors.muted),
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(canteen.location!, style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 10),
                      CanteenStatusLabel(canteen: canteen),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  selected ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
                  color: selected ? ServeColors.oliveStrong : ServeColors.line,
                  semanticLabel: selected ? 'Selected' : null,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
