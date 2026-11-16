import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/ui/screens/role_selection_screen.dart';

import '../support/fakes.dart';

const _google = 'Continue with Google';
const _srmNote = 'Use your SRM University-AP Google account (@srmap.edu.in). Other accounts cannot sign in.';

void _useSize(WidgetTester tester, Size logical) {
  tester.view.physicalSize = logical * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
}

Future<TestHarness> _openLogin(WidgetTester tester) async {
  final h = TestHarness();
  await tester.pumpWidget(h.app);
  await h.auth.restore();
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Student'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Student'));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  setUp(() {
    RoleSelectionScreen.debugResetIntro();
    RoleSelectionScreen.maxImageWait = Duration.zero;
  });
  tearDown(() {
    RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
  });

  testWidgets('offers Google sign-in for SRM accounts only, with no password field', (tester) async {
    usePhoneSize(tester);
    final h = await _openLogin(tester);
    expect(find.widgetWithText(FilledButton, _google), findsOneWidget);
    expect(find.text(_srmNote), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    expect(h.google.calls, isEmpty);
  });

  testWidgets('the sign-in button is a labelled button for screen readers', (tester) async {
    usePhoneSize(tester);
    final semantics = tester.ensureSemantics();
    await _openLogin(tester);
    expect(
      tester.getSemantics(find.widgetWithText(FilledButton, _google)),
      isSemantics(label: _google, isButton: true, hasTapAction: true, isEnabled: true, hasEnabledState: true, isFocusable: true),
    );
    semantics.dispose();
  });

  testWidgets('shows a loading state while signing in, then opens home', (tester) async {
    usePhoneSize(tester);
    final h = await _openLogin(tester);
    final gate = h.google.signInGate = Completer<void>();
    await tester.tap(find.widgetWithText(FilledButton, _google));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    gate.complete();
    await tester.pumpAndSettle();
    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(h.google.calls, ['google']);
  });

  testWidgets('a refused Google account is explained and stays on the sign-in pane', (tester) async {
    usePhoneSize(tester);
    final h = await _openLogin(tester);
    h.google.signInError = const AuthException(
      'EMAIL_DOMAIN_NOT_ALLOWED',
      'Use your SRM University-AP Google account (@srmap.edu.in). Other accounts cannot sign in.',
    );
    await tester.tap(find.widgetWithText(FilledButton, _google));
    await tester.pumpAndSettle();
    // Shown as an error banner above the button (the note below repeats the rule).
    expect(find.text(_srmNote), findsNWidgets(2));
    expect(find.text('Hi, Asha'), findsNothing);
    expect(h.store.value, isNull);
  });

  for (final (name, size) in [
    ('desktop 1440', const Size(1440, 900)),
    ('laptop 1280', const Size(1280, 800)),
    ('tablet 768', const Size(768, 1024)),
    ('iPhone 390', const Size(390, 844)),
    ('iPhone 430', const Size(430, 932)),
    ('Android 360', const Size(360, 800)),
    ('small phone 360', const Size(360, 640)),
  ]) {
    testWidgets('lays out without overflow at $name', (tester) async {
      _useSize(tester, size);
      await _openLogin(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Sign in to SERVE'), findsOneWidget);
      expect(find.text('Order. Track. Collect.'), findsOneWidget);
      final popup = tester.getRect(find.ancestor(of: find.text(_srmNote), matching: find.byType(Material)).first);
      expect(popup.width, lessThanOrEqualTo(440));
      expect((popup.center.dx - size.width / 2).abs(), lessThan(24));
      final button = tester.getRect(find.widgetWithText(FilledButton, _google));
      expect(button.left, greaterThanOrEqualTo(popup.left));
      expect(button.right, lessThanOrEqualTo(popup.right));
      expect(button.width, lessThanOrEqualTo(440));
      expect(button.height, greaterThanOrEqualTo(48));
    });
  }
}
