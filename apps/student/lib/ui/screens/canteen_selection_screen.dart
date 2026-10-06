import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../widgets/states.dart';
import 'home_screen.dart';

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
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView())
          : canteens.isEmpty
          ? const EmptyView(icon: Icons.storefront_outlined, title: 'No canteens are open right now')
          : ListView.separated(
              padding: const EdgeInsets.all(20),
              itemCount: canteens.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) {
                final c = canteens[i];
                final selected = c.id == selectedId;
                return Card(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: selected ? ServeColors.olive : ServeColors.line, width: selected ? 2 : 1),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => _choose(c),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                                if (c.location != null) ...[
                                  const SizedBox(height: 2),
                                  Text(c.location!, style: const TextStyle(color: ServeColors.muted)),
                                ],
                                const SizedBox(height: 6),
                                CanteenStatusLabel(canteen: c),
                              ],
                            ),
                          ),
                          if (selected) const Icon(Icons.check_circle_rounded, color: ServeColors.olive, semanticLabel: 'Selected'),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
    );
  }
}
