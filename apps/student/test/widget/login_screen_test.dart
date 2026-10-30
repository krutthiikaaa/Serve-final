import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';

final _email = find.byKey(const Key('login-email'));
final _password = find.byKey(const Key('login-password'));

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
  testWidgets('empty form shows inline errors and does not call Firebase', (tester) async {
    usePhoneSize(tester);
    final h = await _openLogin(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your email address'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
    expect(h.firebase.calls, isEmpty);
  });

  testWidgets('password visibility toggles', (tester) async {
    usePhoneSize(tester);
    await _openLogin(tester);
    EditableText field() => tester.widget<EditableText>(find.descendant(of: _password, matching: find.byType(EditableText)));
    expect(field().obscureText, isTrue);
    await tester.tap(find.byTooltip('Show password'));
    await tester.pump();
    expect(field().obscureText, isFalse);
    await tester.tap(find.byTooltip('Hide password'));
    await tester.pump();
    expect(field().obscureText, isTrue);
  });

  testWidgets('fields are labelled for screen readers and the toggle stays a button', (tester) async {
    usePhoneSize(tester);
    final semantics = tester.ensureSemantics();
    await _openLogin(tester);
    final email = tester.getSemantics(_email);
    final password = tester.getSemantics(_password);
    expect(email, isSemantics(isTextField: true));
    expect(email.label, startsWith('Email'));
    expect(password, isSemantics(isTextField: true, isObscured: true));
    expect(password.label, startsWith('Password'));
    expect(tester.getSemantics(find.byTooltip('Show password')), isSemantics(tooltip: 'Show password', isButton: true, hasTapAction: true));
    semantics.dispose();
  });

  testWidgets('shows a loading state while signing in', (tester) async {
    usePhoneSize(tester);
    final h = await _openLogin(tester);
    final gate = h.firebase.signInGate = Completer<void>();
    await tester.enterText(_email, 'asha@example.edu');
    await tester.enterText(_password, 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();
    expect(find.text('Signing in…'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    gate.complete();
    await tester.pumpAndSettle();
    expect(find.text('Hi, Asha'), findsOneWidget);
  });

  testWidgets('Create an account opens registration', (tester) async {
    usePhoneSize(tester);
    await _openLogin(tester);
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);
  });

  for (final (name, size, panel) in [
    ('desktop 1440', const Size(1440, 900), true),
    ('laptop 1280', const Size(1280, 800), true),
    ('tablet 768', const Size(768, 1024), false),
    ('iPhone 390', const Size(390, 844), false),
    ('small phone 360', const Size(360, 640), false),
  ]) {
    testWidgets('lays out without overflow at $name', (tester) async {
      _useSize(tester, size);
      await _openLogin(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.text('Good food is just a few taps away.'), panel ? findsOneWidget : findsNothing);
      final button = tester.getRect(find.byType(FilledButton));
      expect(button.left, greaterThanOrEqualTo(0));
      expect(button.right, lessThanOrEqualTo(size.width));
      expect(button.width, lessThanOrEqualTo(440));
      expect(button.height, greaterThanOrEqualTo(48));
    });
  }
}
