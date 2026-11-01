import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/auth/session_store.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/api/serve_api.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/ui/screens/role_selection_screen.dart';
import 'package:serve_student/ui/widgets/auth_layout.dart';
import 'package:serve_student/ui/widgets/serve_logo.dart';
import 'package:serve_student/ui/widgets/serve_splash.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import '../support/fakes.dart';

class _FakeLauncher extends UrlLauncherPlatform with MockPlatformInterfaceMixin {
  final launched = <String>[];
  bool result = true;

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    return result;
  }
}

void _useSize(WidgetTester tester, Size logical) {
  tester.view.physicalSize = logical * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
}

Future<void> _tapRole(WidgetTester tester, String title) async {
  await tester.ensureVisible(find.text(title));
  await tester.pumpAndSettle();
  await tester.tap(find.text(title));
  await tester.pumpAndSettle();
}

/// Shows the role screen with its intro just started.
Future<TestHarness> _start(WidgetTester tester) async {
  final h = TestHarness();
  await tester.pumpWidget(h.app);
  await h.auth.restore();
  await tester.pump();
  return h;
}

/// Shows the role screen once its intro has finished.
Future<TestHarness> _open(WidgetTester tester) async {
  final h = await _start(tester);
  await tester.pumpAndSettle();
  return h;
}

final _skip = find.text('Skip');
final _splash = find.byType(ServeSplashStage);
final _sandwichLayer = find.image(const AssetImage('assets/images/sandwich/bread_top.webp'));
Finder _splashLogo() => find.descendant(of: _splash, matching: find.byType(ServeLogo));
Finder _splashTagline() => find.descendant(of: _splash, matching: find.text(serveTagline));

void main() {
  late _FakeLauncher launcher;
  late UrlLauncherPlatform original;

  setUp(() {
    original = UrlLauncherPlatform.instance;
    launcher = _FakeLauncher();
    UrlLauncherPlatform.instance = launcher;
    RoleSelectionScreen.debugResetIntro();
    // Start on the first frame so the timings below are exact.
    RoleSelectionScreen.maxImageWait = Duration.zero;
  });
  tearDown(() {
    UrlLauncherPlatform.instance = original;
    RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
  });

  group('opening animation', () {
    testWidgets('plays once, then leaves a usable centred popup', (tester) async {
      usePhoneSize(tester);
      await _start(tester);
      expect(_skip, findsOneWidget);
      expect(_splash, findsOneWidget);
      expect(_sandwichLayer, findsNothing);

      await tester.pump(const Duration(milliseconds: 1500));
      await tester.tap(find.text('Student'), warnIfMissed: false);
      await tester.pump();
      expect(find.text('Welcome back'), findsNothing);

      await tester.pump(RoleSelectionScreen.introDuration);
      expect(_skip, findsNothing);
      expect(_splash, findsNothing);
      expect(_sandwichLayer, findsNothing);
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing left animating');

      await _tapRole(tester, 'Student');
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('lasts about 3.2 seconds', (tester) async {
      usePhoneSize(tester);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 3000));
      expect(_skip, findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      expect(_skip, findsNothing);
    });

    for (final size in [const Size(360, 800), const Size(1440, 900)]) {
      testWidgets('shows the official logo and tagline, never the sandwich, at ${size.width.toInt()}', (tester) async {
        _useSize(tester, size);
        await _start(tester);

        await tester.pump(const Duration(milliseconds: 600));
        expect(_splash, findsOneWidget);
        expect(_splashLogo(), findsOneWidget);
        expect(_sandwichLayer, findsNothing);
        final logo = tester.getRect(_splashLogo());
        expect(logo.left, greaterThanOrEqualTo(-4));
        expect(logo.right, lessThanOrEqualTo(size.width + 4));
        expect(logo.top, greaterThanOrEqualTo(-4));
        expect(logo.bottom, lessThanOrEqualTo(size.height + 4));

        await tester.pump(const Duration(milliseconds: 1200));
        expect(_splashTagline(), findsOneWidget);
        expect(_sandwichLayer, findsNothing);

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(_splash, findsNothing);
        expect(find.text('Welcome to SERVE'), findsOneWidget);
      });

      testWidgets('fades into the centred popup at ${size.width.toInt()}', (tester) async {
        _useSize(tester, size);
        await _start(tester);
        double studentOpacity() => tester
            .widgetList<Opacity>(find.ancestor(of: find.text('Student'), matching: find.byType(Opacity)))
            .map((o) => o.opacity)
            .reduce(math.min);

        await tester.pump(const Duration(milliseconds: 1600));
        expect(_splash, findsOneWidget);
        expect(studentOpacity(), 0);

        await tester.pump(const Duration(milliseconds: 1800));
        final popup = tester.getRect(find.ancestor(of: find.text('Welcome to SERVE'), matching: find.byType(Material)).first);
        expect(popup.width, lessThanOrEqualTo(440));
        expect(_sandwichLayer, findsNothing);

        await tester.pumpAndSettle();
        expect(studentOpacity(), 1);
        expect(_splash, findsNothing);
      });
    }

    testWidgets('opens the app with a logo splash and is not restarted by session restore', (tester) async {
      usePhoneSize(tester);
      final h = TestHarness();
      // Still initialising: no saved session has been looked at yet.
      await tester.pumpWidget(h.app);
      expect(find.byType(RoleSelectionScreen), findsOneWidget);
      expect(_skip, findsOneWidget);
      expect(_splash, findsOneWidget);
      final screen = tester.state(find.byType(RoleSelectionScreen));

      await tester.pump(const Duration(milliseconds: 1200));
      await h.auth.restore();
      await tester.pump();
      expect(tester.state(find.byType(RoleSelectionScreen)), same(screen));
      expect(_skip, findsOneWidget, reason: 'the intro carries on');

      await tester.pump(RoleSelectionScreen.introDuration - const Duration(milliseconds: 1100));
      expect(_skip, findsNothing);
      await _tapRole(tester, 'Student');
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('waits (at most 1.5 s) for the official logo, showing only the page colour', (tester) async {
      usePhoneSize(tester);
      RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
      await _start(tester);
      final opacities = tester.widgetList<Opacity>(find.ancestor(of: _splashLogo(), matching: find.byType(Opacity)));
      expect(opacities.any((o) => o.opacity == 0), isTrue, reason: 'nothing drawn before the logo is ready');
      expect(_skip, findsOneWidget);
      expect(_sandwichLayer, findsNothing);

      // However long the image takes, the intro is over within the wait plus its own length.
      await tester.pump(RoleSelectionScreen.maxImageWait + RoleSelectionScreen.introDuration + const Duration(milliseconds: 100));
      expect(_skip, findsNothing);
    });

    testWidgets('Skip works while waiting for the images', (tester) async {
      usePhoneSize(tester);
      RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(_skip);
      await tester.pump();
      expect(_skip, findsNothing);
      expect(tester.binding.transientCallbackCount, 0);
      await _tapRole(tester, 'Administrator');
      expect(find.text('Admin sign in'), findsOneWidget);
      expect(launcher.launched, isEmpty);
    });

    testWidgets('a saved student session still goes straight home', (tester) async {
      usePhoneSize(tester);
      final h = TestHarness();
      h.store.value = const StoredSession(uid: 'u1', email: 'asha@example.edu', refreshToken: 'refresh');
      await tester.pumpWidget(h.app);
      await h.auth.restore();
      await tester.pumpAndSettle();
      expect(find.byType(RoleSelectionScreen), findsNothing);
      expect(find.text('Hi, Asha'), findsOneWidget);
    });

    testWidgets('Skip jumps straight to the finished screen', (tester) async {
      usePhoneSize(tester);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 600));
      await tester.tap(_skip);
      await tester.pump();
      expect(_skip, findsNothing);
      expect(_splash, findsNothing);
      expect(_sandwichLayer, findsNothing);
      expect(tester.binding.transientCallbackCount, 0, reason: 'the intro controller has stopped');
      // Every role is fully shown and usable right away.
      for (final opacity in tester.widgetList<Opacity>(find.ancestor(of: find.text('Administrator'), matching: find.byType(Opacity)))) {
        expect(opacity.opacity, 1);
      }
      await _tapRole(tester, 'Canteen Staff');
      expect(find.text('Staff sign in'), findsOneWidget);
      expect(launcher.launched, isEmpty);
    });

    testWidgets('is disposed cleanly when the screen goes away mid-intro', (tester) async {
      usePhoneSize(tester);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 800));
      await tester.pumpWidget(const SizedBox.shrink());
      expect(tester.takeException(), isNull);
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('does not replay when coming back from sign-in', (tester) async {
      usePhoneSize(tester);
      await _open(tester);
      await _tapRole(tester, 'Student');
      await tester.tap(find.byType(BackButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Welcome to SERVE'), findsOneWidget);
      expect(_skip, findsNothing);
      expect(_splash, findsNothing);
      expect(_sandwichLayer, findsNothing);
      await tester.pumpAndSettle();
      await _tapRole(tester, 'Administrator');
      expect(find.text('Admin sign in'), findsOneWidget);
      expect(_skip, findsNothing);
      expect(launcher.launched, isEmpty);
    });

    testWidgets('is skipped when the platform asks for reduced motion', (tester) async {
      usePhoneSize(tester);
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await _start(tester);
      expect(_skip, findsNothing);
      await _tapRole(tester, 'Student');
      expect(find.text('Welcome back'), findsOneWidget);
    });
  });

  testWidgets('shows the brand, headline and the three roles', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.text('Welcome to SERVE'), findsOneWidget);
    expect(find.text('Choose how you would like to continue.'), findsOneWidget);
    expect(find.text('Order and track your food'), findsOneWidget);
    expect(find.text('Manage orders and your canteen'), findsOneWidget);
    expect(find.text('Manage SERVE and oversee operations'), findsOneWidget);
  });

  testWidgets('Student opens the sign-in screen', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Student');
    expect(find.text('Welcome back'), findsOneWidget);
    expect(launcher.launched, isEmpty);
  });

  testWidgets('Canteen Staff opens staff sign-in in the same popup', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Canteen Staff');
    expect(find.text('Staff sign in'), findsOneWidget);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(find.text('Canteen Staff'), findsNothing);
    expect(launcher.launched, isEmpty);
  });

  testWidgets('Administrator opens admin sign-in in the same popup', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Administrator');
    expect(find.text('Admin sign in'), findsOneWidget);
    expect(find.text('Order. Track. Collect.'), findsOneWidget);
    expect(launcher.launched, isEmpty);
  });

  testWidgets('Back from login restores role selection without replaying the intro', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Student');
    expect(find.text('Welcome back'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Welcome to SERVE'), findsOneWidget);
    expect(find.text('Canteen Staff'), findsOneWidget);
    expect(_skip, findsNothing);
    await _tapRole(tester, 'Canteen Staff');
    expect(find.text('Staff sign in'), findsOneWidget);
  });

  testWidgets('staff sign-in opens the dashboard for a staff account', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'STAFF', name: 'Kiran');
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _tapRole(tester, 'Canteen Staff');
    await tester.enterText(find.byKey(const Key('login-email')), 'staff.kg@serve.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(h.api.calls, contains('sso:STAFF'));
    expect(launcher.launched, ['http://localhost:5173/sso/callback?code=test-staff-code-xx']);
    expect(find.text('Welcome to SERVE'), findsOneWidget);
    expect(h.auth.status, AuthStatus.signedOut);
  });

  testWidgets('admin sign-in opens the portal for an admin account', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'ADMIN', name: 'Ada');
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _tapRole(tester, 'Administrator');
    await tester.enterText(find.byKey(const Key('login-email')), 'admin@serve.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(h.api.calls, contains('sso:ADMIN'));
    expect(launcher.launched, ['http://localhost:5174/sso/callback?code=test-admin-code-xx']);
  });

  testWidgets('a portal that cannot be opened says so', (tester) async {
    usePhoneSize(tester);
    launcher.result = false;
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'ADMIN', name: 'Ada');
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _tapRole(tester, 'Administrator');
    await tester.enterText(find.byKey(const Key('login-email')), 'admin@serve.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Could not open the admin portal.'), findsOneWidget);
  });

  testWidgets('refuses a dashboard URL that carries a token', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'STAFF', name: 'Kiran');
    h.api.onInitiateSso = (_) => SsoHandoff(
      redirectUrl: 'http://localhost:5173/sso/callback?code=test-staff-code-xx&token=secret',
      expiresAt: DateTime.now().add(const Duration(seconds: 60)),
    );
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _tapRole(tester, 'Canteen Staff');
    await tester.enterText(find.byKey(const Key('login-email')), 'staff.kg@serve.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('The staff dashboard link is not configured for this build.'), findsOneWidget);
    expect(launcher.launched, isEmpty);
    expect(h.auth.status, AuthStatus.signedOut);
  });

  testWidgets('failed staff SSO stays on login and does not open a dashboard', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.meValue = const OtherRoleMe(role: 'STAFF', name: 'Kiran');
    h.api.onInitiateSso = (_) => throw const ApiException(403, 'STAFF_NOT_APPROVED', 'Your staff account is awaiting admin approval.');
    await tester.pumpWidget(h.app);
    await h.auth.restore();
    await tester.pumpAndSettle();
    await _tapRole(tester, 'Canteen Staff');
    await tester.enterText(find.byKey(const Key('login-email')), 'staff.kg@serve.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Your staff account is awaiting admin approval.'), findsOneWidget);
    expect(find.text('Staff sign in'), findsOneWidget);
    expect(launcher.launched, isEmpty);
    expect(h.auth.status, AuthStatus.signedOut);
  });

  testWidgets('staff form rejects a student account', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Canteen Staff');
    await tester.enterText(find.byKey(const Key('login-email')), 'asha@example.edu');
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.textContaining('This is a student account'), findsOneWidget);
    expect(find.text('Staff sign in'), findsOneWidget);
    expect(launcher.launched, isEmpty);
  });

  for (final (name, size) in [
    ('desktop 1440', const Size(1440, 900)),
    ('laptop 1280', const Size(1280, 800)),
    ('tablet 768', const Size(768, 1024)),
    ('iPhone Pro Max 430', const Size(430, 932)),
    ('iPhone 390', const Size(390, 844)),
    ('Android 360', const Size(360, 800)),
    ('small phone 360', const Size(360, 640)),
  ]) {
    testWidgets('lays out a centred popup without overflow at $name', (tester) async {
      _useSize(tester, size);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 2500));
      expect(tester.takeException(), isNull);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      final popup = tester.getRect(find.ancestor(of: find.text('Welcome to SERVE'), matching: find.byType(Material)).first);
      expect(popup.width, lessThanOrEqualTo(440));
      expect(popup.left, greaterThanOrEqualTo(0));
      expect(popup.right, lessThanOrEqualTo(size.width));
      expect((popup.center.dx - size.width / 2).abs(), lessThan(24), reason: 'popup is centred');
      if (size.width >= AuthLayout.splitBreakpoint) {
        expect(popup.width, lessThan(size.width * 0.5), reason: 'popup does not stretch across the desktop');
      }

      final student = tester.getRect(find.ancestor(of: find.text('Student'), matching: find.byType(InkWell)).first);
      expect(student.left, greaterThanOrEqualTo(popup.left));
      expect(student.right, lessThanOrEqualTo(popup.right));
      expect(student.height, greaterThanOrEqualTo(48));
      expect(tester.getRect(find.byType(ServeLogo)).center.dx, closeTo(popup.center.dx, popup.width / 2));
    });
  }
}
