import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api/models.dart';
import '../state/recently_viewed_controller.dart';
import 'screens/canteen_selection_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/favourites_screen.dart';
import 'screens/food_details_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/order_details_screen.dart';
import 'screens/order_tracking_screen.dart';

/// Bottom navigation tabs: Home, Menu, Orders, Profile.
class HomeTabs extends ChangeNotifier {
  static const home = 0;
  static const menu = 1;
  static const orders = 2;
  static const profile = 3;

  int index = home;
  String? _pendingMenuSearch;
  var _focusMenuSearch = false;

  String? get pendingMenuSearch => _pendingMenuSearch;
  bool get focusMenuSearch => _focusMenuSearch;

  void go(int tab) {
    if (index == tab) return;
    index = tab;
    notifyListeners();
  }

  /// Opens the existing Menu search — Home does not filter on its own.
  void openMenuSearch([String query = '']) {
    _pendingMenuSearch = query;
    _focusMenuSearch = true;
    index = menu;
    notifyListeners();
  }

  ({String query, bool focus})? takeMenuSearch() {
    if (!_focusMenuSearch && _pendingMenuSearch == null) return null;
    final handed = (query: _pendingMenuSearch ?? '', focus: _focusMenuSearch);
    _pendingMenuSearch = null;
    _focusMenuSearch = false;
    return handed;
  }
}

Route<T> serveRoute<T>(Widget page) => MaterialPageRoute<T>(builder: (_) => page);

void openCart(BuildContext context) => Navigator.of(context).push(serveRoute(const CartScreen()));

void openNotifications(BuildContext context) => Navigator.of(context).push(serveRoute(const NotificationsScreen()));

void openFavourites(BuildContext context) => Navigator.of(context).push(serveRoute(const FavouritesScreen()));

void openFoodDetails(BuildContext context, MenuItem item, {String? categoryName}) {
  context.read<RecentlyViewedController>().record(item);
  Navigator.of(context).push(serveRoute(FoodDetailsScreen(item: item, categoryName: categoryName)));
}

void openCanteenSelection(BuildContext context) => Navigator.of(context).push(serveRoute(const CanteenSelectionScreen()));

void openOrderDetails(BuildContext context, String orderId) => Navigator.of(context).push(serveRoute(OrderDetailsScreen(orderId: orderId)));

void openTracking(BuildContext context, String orderId) => Navigator.of(context).push(serveRoute(OrderTrackingScreen(orderId: orderId)));

/// Leaves a flow (checkout, confirmation…) and returns to a bottom-nav tab.
void backToTab(BuildContext context, int tab) {
  context.read<HomeTabs>().go(tab);
  Navigator.of(context).popUntil((route) => route.isFirst);
}
