import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/auth/auth_controller.dart';

import '../support/fakes.dart';

void main() {
  testWidgets('signed out: role selection → login → home (routed by /me)', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();

    expect(find.text('Student'), findsOneWidget);
    expect(find.text('Canteen staff'), findsOneWidget);
    expect(find.text('Administrator'), findsOneWidget);

    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'asha@example.edu');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(h.realtime.started, isTrue, reason: 'realtime starts only for a registered student');
  });

  testWidgets('wrong password shows a friendly error and stays on login', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.firebase.signInError = const AuthException('INVALID_LOGIN_CREDENTIALS', 'Incorrect email or password.');
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'asha@example.edu');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'nope');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Incorrect email or password.'), findsOneWidget);
    expect(h.auth.status, AuthStatus.signedOut);
  });

  testWidgets('new account: registration with hostel creates Firebase + SERVE accounts', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextFormField, 'Full name'), 'Asha Rao');
    await tester.enterText(find.widgetWithText(TextFormField, 'University email'), 'asha@example.edu');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'secret1');
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Krishna  ·').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();

    expect(h.firebase.calls, ['signUp:asha@example.edu']);
    expect(h.api.calls, contains('register:Asha Rao:asha@example.edu:1c35f533-0000-4000-8000-000000000001'));
    expect(find.text('Hi, Asha'), findsOneWidget);
  });

  testWidgets('registration validates required fields', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your name'), findsOneWidget);
    expect(find.text('Select your hostel'), findsWidgets);
    expect(h.firebase.calls, isEmpty);
  });

  testWidgets('a Firebase user without a SERVE account completes registration', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const UnregisteredMe(email: 'asha@example.edu');
    await tester.pumpWidget(h.app);
    await h.auth.signIn('asha@example.edu', 'pw');
    await tester.pumpAndSettle();
    expect(find.text('Complete your profile'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Password'), findsNothing);
  });

  testWidgets('staff and admin accounts are turned away', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'STAFF', name: 'Kiran');
    await tester.pumpWidget(h.app);
    await h.auth.signIn('staff@serve.dev', 'pw');
    await tester.pumpAndSettle();
    expect(find.text('This is a staff account'), findsOneWidget);
    expect(h.realtime.started, isFalse);
  });

  testWidgets('backend unreachable shows a retryable error', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    var fail = true;
    h.auth.attach(() async {
      if (fail) throw const ApiException(0, 'NETWORK_ERROR', ApiException.networkMessage);
      return h.api.meValue;
    });
    await tester.pumpWidget(h.app);
    await h.auth.signIn('asha@example.edu', 'pw');
    await tester.pumpAndSettle();
    expect(find.text(ApiException.networkMessage), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Hi, Asha'), findsOneWidget);
  });
}
