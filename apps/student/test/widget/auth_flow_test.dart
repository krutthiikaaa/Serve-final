import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/ui/screens/role_selection_screen.dart';

import '../support/fakes.dart';

const _google = 'Continue with Google';

Future<void> _chooseRole(WidgetTester tester, String role) async {
  await tester.ensureVisible(find.text(role));
  await tester.pumpAndSettle();
  await tester.tap(find.text(role));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    RoleSelectionScreen.debugResetIntro();
    RoleSelectionScreen.maxImageWait = Duration.zero;
  });
  tearDown(() {
    RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
  });

  testWidgets('signed out: role selection → Google sign-in → home (routed by /me)', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();

    expect(find.text('Student'), findsOneWidget);
    expect(find.text('Canteen Staff'), findsOneWidget);
    expect(find.text('Administrator'), findsOneWidget);

    await _chooseRole(tester, 'Student');
    await tester.tap(find.widgetWithText(FilledButton, _google));
    await tester.pumpAndSettle();

    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(h.store.value?.token, 'session-token', reason: 'the session survives an app restart');
    expect(h.realtime.started, isTrue, reason: 'realtime starts only for a registered student');
  });

  testWidgets('a signed-in Google account without a SERVE profile completes it (name + hostel)', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const UnregisteredMe(email: 'asha@srmap.edu.in');
    await tester.pumpWidget(h.app);
    await h.auth.signInWithGoogle();
    await tester.pumpAndSettle();
    expect(find.text('Complete your profile'), findsOneWidget);
    expect(find.text('asha@srmap.edu.in'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Password'), findsNothing);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);

    await tester.enterText(find.widgetWithText(TextFormField, 'Full name'), 'Asha Rao');
    await tester.tap(find.text('Select your hostel'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Krishna').last);
    await tester.pumpAndSettle();
    h.api.meValue = h.api.onRegister?.call('Asha Rao', 'x') ?? h.api.meValue;
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Finish registration'));
    await tester.tap(find.widgetWithText(FilledButton, 'Finish registration'));
    await tester.pumpAndSettle();
    // The email is never sent: the server takes it from the Google session.
    expect(h.api.calls.where((c) => c.startsWith('register:')).single, startsWith('register:Asha Rao:'));
    expect(find.text('Hi, Asha'), findsOneWidget);
  });

  testWidgets('registration requires a name and a hostel', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const UnregisteredMe(email: 'asha@srmap.edu.in');
    await tester.pumpWidget(h.app);
    await h.auth.signInWithGoogle();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Finish registration'));
    await tester.tap(find.widgetWithText(FilledButton, 'Finish registration'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your name'), findsOneWidget);
    expect(find.text('Select your hostel'), findsWidgets);
    expect(h.api.calls.where((c) => c.startsWith('register:')), isEmpty);
  });

  testWidgets('"Use a different account" signs out of the Google session', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const UnregisteredMe(email: 'asha@srmap.edu.in');
    await tester.pumpWidget(h.app);
    await h.auth.signInWithGoogle();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Use a different account'));
    await tester.tap(find.text('Use a different account'));
    await tester.pumpAndSettle();
    expect(h.google.calls, contains('signOut:session-token'));
    expect(h.store.value, isNull);
    expect(find.widgetWithText(FilledButton, _google), findsOneWidget);
  });

  testWidgets('staff are sent to the staff dashboard to sign in with email and password', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _chooseRole(tester, 'Canteen Staff');
    expect(find.text('Staff sign in'), findsOneWidget);
    expect(find.textContaining('email and password'), findsOneWidget);
    expect(find.textContaining('@srmap.edu.in'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Open staff dashboard'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    expect(h.google.calls, isEmpty, reason: 'staff never sign in inside the student app');
  });

  testWidgets('admin access is provisioned and opens the admin portal', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _chooseRole(tester, 'Administrator');
    expect(find.text('Admin sign in'), findsOneWidget);
    expect(find.textContaining('no public admin sign-up'), findsOneWidget);
    // Admins use email + password with any address: no SRM-domain requirement.
    expect(find.textContaining('email and password'), findsOneWidget);
    expect(find.textContaining('@srmap.edu.in'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Open admin portal'), findsOneWidget);
    expect(h.google.calls, isEmpty);
  });

  testWidgets('staff and admin accounts are turned away', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'STAFF', name: 'Kiran');
    await tester.pumpWidget(h.app);
    await h.auth.signInWithGoogle();
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
    await h.auth.signInWithGoogle();
    await tester.pumpAndSettle();
    expect(find.text(ApiException.networkMessage), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Hi, Asha'), findsOneWidget);
  });
}
