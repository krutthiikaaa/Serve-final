import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'config/app_config.dart';
import 'services/api/models.dart';
import 'services/api/serve_api.dart';
import 'services/auth/auth_controller.dart';
import 'services/realtime/realtime_service.dart';
import 'services/favourites/favourites_store.dart';
import 'state/canteen_selection.dart';
import 'state/cart_controller.dart';
import 'state/favourites_controller.dart';
import 'state/notifications_controller.dart';
import 'state/recently_viewed_controller.dart';
import 'theme/serve_theme.dart';
import 'ui/navigation.dart';
import 'ui/screens/home_shell.dart';
import 'ui/screens/signed_out_flow.dart';
import 'ui/screens/status_screens.dart';

/// Everything the UI needs, created once in main() (or by tests with fakes).
class AppServices {
  AppServices({required this.config, required this.auth, required this.api, required this.realtime, FavouritesStore? favouritesStore})
    : cart = CartController(),
      selection = CanteenSelection(),
      notifications = NotificationsController(api, realtime),
      recentlyViewed = RecentlyViewedController(),
      favourites = FavouritesController(favouritesStore ?? MemoryFavouritesStore()),
      tabs = HomeTabs();

  final AppConfig config;
  final AuthController auth;
  final ServeApi api;
  final RealtimeService realtime;
  final CartController cart;
  final CanteenSelection selection;
  final NotificationsController notifications;
  final RecentlyViewedController recentlyViewed;
  final FavouritesController favourites;
  final HomeTabs tabs;
}

class ServeApp extends StatelessWidget {
  const ServeApp({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider.value(value: services.config),
        Provider.value(value: services.api),
        ChangeNotifierProvider.value(value: services.auth),
        ChangeNotifierProvider<RealtimeService>.value(value: services.realtime),
        ChangeNotifierProvider.value(value: services.cart),
        ChangeNotifierProvider.value(value: services.selection),
        ChangeNotifierProvider.value(value: services.notifications),
        ChangeNotifierProvider.value(value: services.recentlyViewed),
        ChangeNotifierProvider.value(value: services.favourites),
        ChangeNotifierProvider.value(value: services.tabs),
      ],
      child: MaterialApp(
        title: 'SERVE',
        debugShowCheckedModeBanner: false,
        theme: buildServeTheme(),
        home: AuthGate(services: services),
      ),
    );
  }
}

/// Routes purely on the backend account (`/api/auth/me`) and owns the
/// session lifecycle: realtime + notifications start for a registered
/// student and everything local is cleared on sign-out.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key, required this.services});
  final AppServices services;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _sessionActive = false;

  AppServices get s => widget.services;

  @override
  void initState() {
    super.initState();
    s.auth.addListener(_onAuth);
    _onAuth();
  }

  @override
  void didUpdateWidget(AuthGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.services == widget.services) return;
    oldWidget.services.auth.removeListener(_onAuth);
    _sessionActive = false;
    s.auth.addListener(_onAuth);
    _onAuth();
  }

  @override
  void dispose() {
    s.auth.removeListener(_onAuth);
    super.dispose();
  }

  void _onAuth() {
    final student = s.auth.status == AuthStatus.ready ? s.auth.student : null;
    if (student != null && !_sessionActive) {
      _sessionActive = true;
      s.selection.initialize(student);
      s.realtime.start();
      s.notifications.start();
    } else if (s.auth.status == AuthStatus.signedOut && _sessionActive) {
      _sessionActive = false;
      s.realtime.stop();
      s.notifications.stop();
      s.cart.clear();
      s.recentlyViewed.clear();
      s.selection.reset();
      s.tabs.go(HomeTabs.home);
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final auth = s.auth;
    // Signed-out launch plays the logo splash, then role selection. The flow
    // stays mounted while a saved session is restored so the animation is not
    // interrupted; a restored student then goes straight home.
    const signedOut = SignedOutFlow(key: ValueKey('signed-out'));
    final child = switch (auth.status) {
      AuthStatus.initializing || AuthStatus.signedOut => signedOut,
      AuthStatus.loadingAccount when auth.me == null => signedOut,
      AuthStatus.error when auth.me == null => AccountErrorScreen(key: const ValueKey('error'), error: auth.error),
      _ => switch (auth.me) {
        UnregisteredMe(:final email) => SignedOutFlow(key: const ValueKey('signed-out'), completeEmail: email),
        OtherRoleMe(:final role) => WrongRoleScreen(key: const ValueKey('wrong-role'), role: role),
        StudentMe() => const HomeShell(key: ValueKey('home')),
        null => signedOut,
      },
    };
    return AnimatedSwitcher(duration: const Duration(milliseconds: 250), child: child);
  }
}
