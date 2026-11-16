import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

const _qr1 = 'aaaa0000-0000-4000-8000-000000000001';
const _qr2 = 'aaaa0000-0000-4000-8000-000000000002';

Future<void> _checkout(WidgetTester tester, TestHarness h) async {
  await h.pumpSignedIn(tester);
  h.services.cart.add(
    fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
    canteenName: 'K&G',
    period: ServicePeriod.night,
  );
  await tester.pump();
  await tester.tap(find.bySemanticsLabel('Cart, 1'));
  await tester.pumpAndSettle();
  await tester.tap(find.widgetWithText(FilledButton, 'Checkout'));
  await tester.pumpAndSettle();
  await tester.tap(find.widgetWithText(FilledButton, 'Place order'));
  await tester.pumpAndSettle();
}

CanteenPaymentConfig _live(String qrId) =>
    CanteenPaymentConfig.fromJson(fx.paymentConfigJson(mode: 'LIVE', upiVpa: 'kg@okicici', merchantName: 'KG Canteen', qrId: qrId));

void main() {
  testWidgets('payment shows the order canteen’s uploaded QR and swaps it live when replaced', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.paymentConfigs[fx.kgId] = _live(_qr1);
    await _checkout(tester, h);

    // Fetched for this order (its own canteen), never by a client-chosen canteen.
    expect(h.api.calls.where((c) => c.startsWith('orderPaymentConfig:')), isNotEmpty);
    expect(h.api.calls.where((c) => c.startsWith('paymentConfig:')), isEmpty);
    expect(find.byKey(const ValueKey(_qr1)), findsOneWidget);
    final image = tester.widget<Image>(find.byKey(const ValueKey(_qr1)));
    expect((image.image as NetworkImage).url, 'http://fake/api/qr-codes/$_qr1');
    expect(find.text('DEMO ONLY — NOT PAYABLE'), findsNothing);

    // An admin replaces the QR: the screen refetches and shows the new one.
    h.api.paymentConfigs[fx.kgId] = _live(_qr2);
    h.realtime.emit('canteen.payment_qr_updated', {'canteenId': fx.kgId, 'qrId': _qr2});
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey(_qr1)), findsNothing);
    expect(find.byKey(const ValueKey(_qr2)), findsOneWidget);

    // Another canteen's QR update is ignored.
    final before = h.api.calls.where((c) => c.startsWith('orderPaymentConfig:')).length;
    h.realtime.emit('canteen.payment_qr_updated', {'canteenId': fx.vedId, 'qrId': _qr1});
    await tester.pumpAndSettle();
    expect(h.api.calls.where((c) => c.startsWith('orderPaymentConfig:')).length, before);
    // Showing a QR never confirms anything.
    expect(find.text('Payment confirmed'), findsNothing);
  });

  testWidgets('shows a clear error instead of a broken QR when none is available', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.paymentConfigs[fx.kgId] = CanteenPaymentConfig.fromJson(fx.paymentConfigJson(withDemoQr: false));
    await _checkout(tester, h);
    expect(find.text('The payment QR for this canteen is not available right now.'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('test-mode canteens show only the labelled DEMO placeholder', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.paymentConfigs[fx.kgId] = CanteenPaymentConfig.fromJson(fx.paymentConfigJson());
    await _checkout(tester, h);
    expect(find.text('DEMO ONLY — NOT PAYABLE'), findsOneWidget);
    expect(find.textContaining('Test mode.'), findsOneWidget);
    expect(find.textContaining('DEMO mode'), findsNothing);
  });
}
