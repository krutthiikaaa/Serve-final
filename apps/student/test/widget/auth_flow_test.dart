import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/ui/screens/role_selection_screen.dart';
import 'package:serve_student/ui/widgets/sandwich_intro.dart';

import '../support/fakes.dart';

final loginEmail = find.byKey(const Key('login-email'));
final loginPassword = find.byKey(const Key('login-password'));

void main() {
  setUp(() {
    RoleSelectionScreen.debugResetIntro();
    RoleSelectionScreen.maxImageWait = Duration.zero;
  });
  tearDown(() {
    RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
  });

  testWidgets('signed out: role selection → login → home (routed by /me)', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();

    expect(find.text('Student'), findsOneWidget);
    expect(find.text('Canteen Staff'), findsOneWidget);
    expect(find.text('Administrator'), findsOneWidget);

    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);

    await tester.enterText(loginEmail, 'asha@example.edu');
    await tester.enterText(loginPassword, 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(h.api.calls.where((c) => c.startsWith('sso:')), isEmpty);
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
    await tester.enterText(loginEmail, 'asha@example.edu');
    await tester.enterText(loginPassword, 'nope');
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

  testWidgets('Create an account stays in the same popup', (tester) async {
    usePhoneSize(tester);
    await tester.pumpWidget(TestHarness().app);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);
    expect(find.byType(RoleSelectionScreen), findsOneWidget);
    expect(find.byType(SandwichIntroStage), findsNothing);
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.byType(SandwichIntroStage), findsNothing);
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
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);
  });

  testWidgets('student forgot password sends a Firebase reset and stays in the popup', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Student'));
    await tester.pumpAndSettle();
    await tester.enterText(loginEmail, 'asha@example.edu');
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();
    expect(find.text('Reset your password'), findsOneWidget);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Send reset link'));
    await tester.pumpAndSettle();
    expect(h.firebase.calls, ['reset:asha@example.edu']);
    expect(find.textContaining('Reset email sent'), findsOneWidget);
    await tester.tap(find.text('Back to login'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.byType(SandwichIntroStage), findsNothing);
  });

  testWidgets('staff create account requests access and stays pending', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Canteen Staff'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    expect(find.text('Request staff access'), findsOneWidget);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);

    await tester.enterText(find.widgetWithText(TextFormField, 'Full name'), 'Kiran Rao');
    await tester.enterText(find.widgetWithText(TextFormField, 'Work email'), 'kiran@serve.dev');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'secret1');
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Krishna & Godavari Night Canteen').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Request access'));
    await tester.pumpAndSettle();

    expect(h.firebase.calls, ['signUp:kiran@serve.dev']);
    expect(h.api.calls, contains('registerStaff:Kiran Rao:kiran@serve.dev:9703a1b2-0000-4000-8000-000000000001'));
    expect(find.text('Request sent'), findsOneWidget);
    expect(h.auth.status, AuthStatus.signedOut);
    expect(find.text('Hi, Asha'), findsNothing);
  });

  testWidgets('admin create account is provisioning-only', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Administrator'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();
    expect(find.text('Admin accounts are provisioned'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Full name'), findsNothing);
    expect(h.firebase.calls, isEmpty);
    expect(h.api.calls, isEmpty);
    await tester.tap(find.widgetWithText(FilledButton, 'Back to login'));
    await tester.pumpAndSettle();
    expect(find.text('Admin sign in'), findsOneWidget);
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
