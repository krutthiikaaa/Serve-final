import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/state/cart_controller.dart';

import '../support/fixtures.dart';

void main() {
  final veg = item('i1', 'Veg Sandwich', price: 5000);
  final tea = item('i2', 'Tea', price: 2500);
  final other = item('i9', 'Other canteen dosa', canteenId: vedId);
  final soldOut = item('i3', 'Sold out', availability: 'UNAVAILABLE');

  test('adds, increments and decrements lines', () {
    final cart = CartController();
    expect(cart.add(veg, canteenName: 'K&G'), AddResult.added);
    cart.add(veg, canteenName: 'K&G');
    cart.add(tea, canteenName: 'K&G');
    expect(cart.itemCount, 3);
    expect(cart.quantityOf('i1'), 2);
    cart.decrement('i1');
    cart.decrement('i2');
    expect(cart.lines.map((l) => l.item.id), ['i1']);
    expect(cart.canteenId, kgId);
  });

  test('a cart belongs to one canteen', () {
    final cart = CartController()..add(veg, canteenName: 'K&G');
    expect(cart.conflictsWith(vedId), isTrue);
    expect(cart.add(other, canteenName: 'Vedavathi'), AddResult.differentCanteen);
    expect(cart.itemCount, 1);
    cart.clear();
    expect(cart.canteenId, isNull);
    expect(cart.add(other, canteenName: 'Vedavathi'), AddResult.added);
  });

  test('refuses unorderable items and caps quantities at 20', () {
    final cart = CartController();
    expect(cart.add(soldOut, canteenName: 'K&G'), AddResult.notOrderable);
    for (var i = 0; i < CartController.maxQuantity; i++) {
      cart.add(veg, canteenName: 'K&G');
    }
    expect(cart.add(veg, canteenName: 'K&G'), AddResult.limitReached);
    expect(cart.quantityOf('i1'), 20);
  });

  test('submits only item ids and quantities', () {
    final cart = CartController()
      ..add(veg, canteenName: 'K&G')
      ..add(veg, canteenName: 'K&G');
    expect(cart.toInputs().map((i) => i.toJson()), [
      {'menuItemId': 'i1', 'quantity': 2},
    ]);
  });
}
