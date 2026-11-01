import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/state/recently_viewed_controller.dart';

import '../support/fixtures.dart' as fx;

void main() {
  test('records the latest viewed item first and skips inactive items', () {
    final viewed = RecentlyViewedController();
    final veg = fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich');
    final paneer = fx.item('a1000000-0000-4000-8000-000000000002', 'Paneer Grilled Sandwich', availability: 'UNAVAILABLE');
    viewed.record(fx.item('a1000000-0000-4000-8000-000000000003', 'Retired Sandwich', availability: 'INACTIVE'));
    viewed.record(veg);
    viewed.record(paneer);
    viewed.record(veg);
    expect(viewed.items.map((i) => i.name), ['Veg Grilled Sandwich', 'Paneer Grilled Sandwich']);
  });

  test('only returns items that still exist on the current canteen menu', () {
    final viewed = RecentlyViewedController();
    viewed.record(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'));
    viewed.record(fx.item('dead0000-0000-4000-8000-000000000099', 'Gone'));
    viewed.record(fx.item('b1000000-0000-4000-8000-000000000001', 'Other Canteen Item', canteenId: fx.vedId));
    final visible = viewed.visibleOn(fx.menu());
    expect(visible.map((e) => e.item.name), ['Veg Grilled Sandwich']);
    expect(visible.single.categoryName, 'Sandwiches');
  });
}
