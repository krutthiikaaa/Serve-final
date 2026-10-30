import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:serve_student/services/auth/session_store.dart';
import 'package:serve_student/ui/screens/role_selection_screen.dart';
import 'package:serve_student/ui/widgets/auth_layout.dart';
import 'package:serve_student/ui/widgets/sandwich_intro.dart';
import 'package:serve_student/ui/widgets/serve_logo.dart';
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

const _layerNames = ['bread_top', 'lettuce', 'tomato', 'cheese', 'cucumber', 'bread_bottom'];
Finder _layerFinder(String name) => find.image(AssetImage('assets/images/sandwich/$name.webp'));

/// The intro's copy of a layer: the last one in the tree.
Rect _layer(WidgetTester tester, String name) => tester.getRect(_layerFinder(name).last);

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
      expect(find.byType(SandwichIntroStage), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 1500));
      await tester.tap(find.text('Student'), warnIfMissed: false);
      await tester.pump();
      expect(find.text('Welcome back'), findsNothing);

      await tester.pump(RoleSelectionScreen.introDuration);
      expect(_skip, findsNothing);
      expect(find.byType(SandwichIntroStage), findsNothing);
      expect(tester.binding.transientCallbackCount, 0, reason: 'nothing left animating');

      await _tapRole(tester, 'Student');
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('lasts about 4.8 seconds', (tester) async {
      usePhoneSize(tester);
      await _start(tester);
      await tester.pump(const Duration(milliseconds: 4600));
      expect(_skip, findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      expect(_skip, findsNothing);
    });

    for (final size in [const Size(360, 800), const Size(1440, 900)]) {
      testWidgets('bursts into separate ingredients that stay on screen at ${size.width.toInt()}', (tester) async {
        _useSize(tester, size);
        await _start(tester);

        await tester.pump(const Duration(milliseconds: 600));
        final assembledGap = (_layer(tester, 'bread_top').center - _layer(tester, 'bread_bottom').center).distance;

        await tester.pump(const Duration(milliseconds: 1200));
        final top = _layer(tester, 'bread_top');
        final bottom = _layer(tester, 'bread_bottom');
        expect((top.center - bottom.center).distance, greaterThan(assembledGap * 2), reason: 'the slices fly apart');
        expect(_layer(tester, 'tomato').center.dx, lessThan(_layer(tester, 'cheese').center.dx), reason: 'fillings spread to both sides');
        for (final name in _layerNames) {
          final r = _layer(tester, name);
          expect(r.left, greaterThanOrEqualTo(-4), reason: '$name clipped left');
          expect(r.right, lessThanOrEqualTo(size.width + 4), reason: '$name clipped right');
          expect(r.top, greaterThanOrEqualTo(-4), reason: '$name clipped top');
          expect(r.bottom, lessThanOrEqualTo(size.height + 4), reason: '$name clipped bottom');
        }

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ingredients travel into the centred popup at ${size.width.toInt()}', (tester) async {
        _useSize(tester, size);
        await _start(tester);
        double studentOpacity() => tester
            .widgetList<Opacity>(find.ancestor(of: find.text('Student'), matching: find.byType(Opacity)))
            .map((o) => o.opacity)
            .reduce(math.min);

        await tester.pump(const Duration(milliseconds: 2200));
        final burst = {for (final n in _layerNames) n: _layer(tester, n).center};
        expect(studentOpacity(), 0);

        await tester.pump(const Duration(milliseconds: 1800));
        final popup = tester.getRect(find.ancestor(of: find.text('Welcome to SERVE'), matching: find.byType(Material)).first);
        for (final n in _layerNames) {
          final r = _layer(tester, n);
          expect((r.center - burst[n]!).distance, greaterThan(8), reason: '$n left its burst position');
          expect(r.center.dx, inInclusiveRange(popup.left - 48, popup.right + 48), reason: '$n is at the popup');
          expect(r.center.dy, inInclusiveRange(popup.top - 48, popup.bottom + 48), reason: '$n is at the popup');
        }
        expect(popup.width, lessThanOrEqualTo(440));

        await tester.pumpAndSettle();
        expect(studentOpacity(), 1);
        expect(find.byType(SandwichIntroStage), findsNothing);
      });
    }

    testWidgets('opens the app with no splash screen and is not restarted by session restore', (tester) async {
      usePhoneSize(tester);
      final h = TestHarness();
      // Still initialising: no saved session has been looked at yet.
      await tester.pumpWidget(h.app);
      expect(find.byType(RoleSelectionScreen), findsOneWidget);
      expect(_skip, findsOneWidget);
      final screen = tester.state(find.byType(RoleSelectionScreen));

      await tester.pump(const Duration(milliseconds: 1500));
      await h.auth.restore();
      await tester.pump();
      expect(tester.state(find.byType(RoleSelectionScreen)), same(screen));
      expect(_skip, findsOneWidget, reason: 'the intro carries on');

      await tester.pump(RoleSelectionScreen.introDuration - const Duration(milliseconds: 1400));
      expect(_skip, findsNothing);
      await _tapRole(tester, 'Student');
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('waits (at most 1.5 s) for the sandwich images, showing only the page colour', (tester) async {
      usePhoneSize(tester);
      RoleSelectionScreen.maxImageWait = const Duration(milliseconds: 1500);
      await _start(tester);
      final opacities = tester.widgetList<Opacity>(find.ancestor(of: _layerFinder('bread_top').last, matching: find.byType(Opacity)));
      expect(opacities.any((o) => o.opacity == 0), isTrue, reason: 'nothing drawn before the images are ready');
      expect(_skip, findsOneWidget);

      // However long the images take, the intro is over within the wait plus its own length.
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
      expect(launcher.launched, ['http://localhost:5174']);
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
      expect(find.byType(SandwichIntroStage), findsNothing);
      expect(tester.binding.transientCallbackCount, 0, reason: 'the intro controller has stopped');
      // Every role is fully shown and usable right away.
      for (final opacity in tester.widgetList<Opacity>(find.ancestor(of: find.text('Administrator'), matching: find.byType(Opacity)))) {
        expect(opacity.opacity, 1);
      }
      await _tapRole(tester, 'Canteen Staff');
      expect(launcher.launched, ['http://localhost:5173']);
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
      expect(find.byType(SandwichIntroStage), findsNothing);
      await tester.pumpAndSettle();
      await _tapRole(tester, 'Administrator');
      expect(launcher.launched, ['http://localhost:5174']);
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

  testWidgets('Canteen Staff opens the staff dashboard', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Canteen Staff');
    expect(launcher.launched, ['http://localhost:5173']);
    expect(find.text('Welcome to SERVE'), findsOneWidget);
  });

  testWidgets('Administrator opens the admin portal', (tester) async {
    usePhoneSize(tester);
    await _open(tester);
    await _tapRole(tester, 'Administrator');
    expect(launcher.launched, ['http://localhost:5174']);
  });

  testWidgets('a portal that cannot be opened says so', (tester) async {
    usePhoneSize(tester);
    launcher.result = false;
    await _open(tester);
    await _tapRole(tester, 'Administrator');
    expect(find.text('Could not open the admin portal.'), findsOneWidget);
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
