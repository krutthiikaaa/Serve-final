import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/canteen_selection.dart';
import '../../state/favourites_controller.dart';
import '../../theme/serve_layout.dart';
import '../widgets/food_product_card.dart';
import '../widgets/states.dart';

/// Favourites resolved against the selected canteen's current menu.
class FavouritesScreen extends StatefulWidget {
  const FavouritesScreen({super.key});

  @override
  State<FavouritesScreen> createState() => _FavouritesScreenState();
}

class _FavouritesScreenState extends State<FavouritesScreen> {
  Menu? _menu;
  Object? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = context.read<CanteenSelection>().id;
    if (id == null) return;
    final generation = ++_generation;
    setState(() => _error = null);
    try {
      final menu = await context.read<ServeApi>().menu(id);
      if (mounted && generation == _generation) setState(() => _menu = menu);
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final menu = _menu;
    final favourites = context.watch<FavouritesController>();
    final items = menu == null ? const <({MenuItem item, String? categoryName})>[] : favourites.visibleOn(menu);
    return Scaffold(
      appBar: AppBar(title: const Text('Favourites')),
      body: menu == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const SkeletonList(label: 'Loading favourites'))
          : items.isEmpty
          ? EmptyView(
              icon: Icons.favorite_border_rounded,
              title: favourites.count == 0 ? 'No favourites yet' : 'None of your favourites are on this menu',
              body: favourites.count == 0
                  ? 'Tap the heart on a dish to save it here.'
                  : 'Switch canteen or browse the menu — saved items stay on this device.',
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final width = constraints.maxWidth;
                final padding = ServeLayout.pagePadding(width);
                final compact = width < 600;
                final inner = width - padding * 2;
                final columns = ServeLayout.gridColumns(inner);
                return GridView.builder(
                  padding: EdgeInsets.fromLTRB(padding, 12, padding, 32),
                  itemCount: items.length,
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    mainAxisExtent: ServeLayout.cardExtent(inner, columns, compact || columns >= 3),
                  ),
                  itemBuilder: (context, i) => FoodProductCard(
                    item: items[i].item,
                    canteen: menu.canteen,
                    categoryName: items[i].categoryName,
                    compact: compact || columns >= 3,
                  ),
                );
              },
            ),
    );
  }
}
