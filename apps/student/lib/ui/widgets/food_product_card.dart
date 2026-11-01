import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../navigation.dart';
import 'favourite_button.dart';
import 'food_image.dart';
import 'quantity_control.dart';

/// Compact menu card. Image source, add-to-cart, and details tap stay the same.
class FoodProductCard extends StatefulWidget {
  const FoodProductCard({super.key, required this.item, required this.canteen, required this.categoryName, this.compact = false});

  final MenuItem item;
  final Canteen canteen;
  final String? categoryName;
  final bool compact;

  @override
  State<FoodProductCard> createState() => _FoodProductCardState();
}

class _FoodProductCardState extends State<FoodProductCard> {
  var _hover = false;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final quantity = context.select<CartController, int>((c) => c.quantityOf(item.id));
    final unavailable = item.availability == Availability.unavailable;
    return Semantics(
      button: true,
      hint: 'Shows details',
      child: MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: ServeColors.ink.withValues(alpha: _hover ? 0.10 : 0.04),
                blurRadius: _hover ? 14 : 8,
                offset: Offset(0, _hover ? 6 : 2),
              ),
            ],
          ),
          child: Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: const BorderSide(color: ServeColors.line),
            ),
            child: InkWell(
              onTap: () => openFoodDetails(context, item, categoryName: widget.categoryName),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: Opacity(
                            opacity: item.isOrderable ? 1 : 0.5,
                            child: FoodImage(
                              imageUrl: item.imageUrl,
                              category: widget.categoryName,
                              width: double.infinity,
                              height: double.infinity,
                              radius: 0,
                            ),
                          ),
                        ),
                        Positioned(top: 6, left: 6, child: FavouriteButton(itemId: item.id, itemName: item.name)),
                        Positioned(
                          top: 6,
                          right: 6,
                          child: FittedBox(
                            child: QuantityControl(
                              quantity: quantity,
                              itemName: item.name,
                              enabled: item.isOrderable,
                              onAdd: () => addToCart(context, item, canteenName: widget.canteen.name),
                              onRemove: () => context.read<CartController>().decrement(item.id),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(widget.compact ? 8 : 10, 8, widget.compact ? 8 : 10, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Flexible(
                            child: Text(
                              item.name,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: widget.compact ? 13 : 14,
                                height: 1.2,
                                color: item.isOrderable ? ServeColors.ink : ServeColors.muted,
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            formatRupees(item.pricePaise),
                            style: TextStyle(fontWeight: FontWeight.w800, fontSize: widget.compact ? 13 : 14, color: ServeColors.oliveInk),
                          ),
                          if (unavailable) const Padding(padding: EdgeInsets.only(top: 2), child: _UnavailableTag()),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UnavailableTag extends StatelessWidget {
  const _UnavailableTag();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: ServeColors.orangeTint, borderRadius: BorderRadius.circular(6)),
    child: const Text(
      'Unavailable',
      style: TextStyle(color: ServeColors.orangeInk, fontSize: 11, fontWeight: FontWeight.w700),
    ),
  );
}
