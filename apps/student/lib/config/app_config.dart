import 'package:flutter/foundation.dart';

/// Build-time configuration, passed with `--dart-define` (see README).
///
/// Only public values belong here: the API origin, the Firebase web API key
/// and project id. Firebase Admin credentials, database passwords and payment
/// secrets live exclusively on the backend.
class AppConfig {
  const AppConfig({
    required this.apiUrl,
    required this.firebaseApiKey,
    required this.firebaseProjectId,
    this.authEmulatorHost,
    this.staffDashboardUrl,
    this.adminPortalUrl,
  });

  factory AppConfig.fromEnvironment() {
    final config = AppConfig.resolve(
      apiUrl: const String.fromEnvironment('API_URL'),
      firebaseApiKey: const String.fromEnvironment('FIREBASE_API_KEY'),
      firebaseProjectId: const String.fromEnvironment('FIREBASE_PROJECT_ID'),
      authEmulatorHost: const String.fromEnvironment('FIREBASE_AUTH_EMULATOR_HOST'),
      staffDashboardUrl: const String.fromEnvironment('STAFF_DASHBOARD_URL'),
      adminPortalUrl: const String.fromEnvironment('ADMIN_PORTAL_URL'),
      isRelease: const bool.fromEnvironment('dart.vm.product'),
      isAndroidDevice: !kIsWeb && defaultTargetPlatform == TargetPlatform.android,
      // A built web app (profile/release) is served by the SERVE domain itself.
      // `flutter run` serves it from a dev server, which is not the backend.
      servedFrom: kIsWeb && !kDebugMode ? Uri.base.origin : null,
    );
    config.validate(isRelease: const bool.fromEnvironment('dart.vm.product'));
    return config;
  }

  /// Applies development defaults to the `--dart-define` values (empty = not set).
  ///
  /// A plain `flutter run` must just work against the local stack: the backend
  /// on port 5001 and the Firebase Auth Emulator on 9099. The Android emulator
  /// reaches the host machine as 10.0.2.2, everything else as localhost.
  /// A `demo-` Firebase project only exists in the emulator, so it always uses
  /// the emulator unless one is named explicitly. Release builds get no
  /// defaults beyond these and are rejected by [validate] unless configured.
  ///
  /// [servedFrom] is the origin a built web app was loaded from. On the single
  /// SERVE domain it is also the backend (`/api`, `/socket.io`) and hosts the
  /// staff dashboard (`/staff/`) and admin portal (`/admin/`), so those are
  /// the defaults there.
  factory AppConfig.resolve({
    String apiUrl = '',
    String firebaseApiKey = '',
    String firebaseProjectId = '',
    String authEmulatorHost = '',
    String staffDashboardUrl = '',
    String adminPortalUrl = '',
    required bool isRelease,
    required bool isAndroidDevice,
    String? servedFrom,
  }) {
    final host = isAndroidDevice ? '10.0.2.2' : 'localhost';
    final projectId = firebaseProjectId.isEmpty ? 'demo-serve' : firebaseProjectId;
    final api = apiUrl.isNotEmpty ? apiUrl : servedFrom ?? 'http://$host:5001';
    String? portal(String configured, String path, String devUrl) => configured.isNotEmpty
        ? configured
        : servedFrom != null
        ? '$servedFrom$path'
        : isRelease
        ? null
        : devUrl;
    final emulator = authEmulatorHost.isNotEmpty
        ? authEmulatorHost
        : (!isRelease && projectId.startsWith('demo-'))
        ? '${isAndroidDevice ? '10.0.2.2' : '127.0.0.1'}:9099'
        : null;
    return AppConfig(
      apiUrl: api.endsWith('/') ? api.substring(0, api.length - 1) : api,
      firebaseApiKey: firebaseApiKey.isEmpty ? 'demo-api-key' : firebaseApiKey,
      firebaseProjectId: projectId,
      authEmulatorHost: emulator,
      staffDashboardUrl: portal(staffDashboardUrl, '/staff/', 'http://localhost:5173'),
      adminPortalUrl: portal(adminPortalUrl, '/admin/', 'http://localhost:5174'),
    );
  }

  final String apiUrl;
  final String firebaseApiKey;
  final String firebaseProjectId;

  /// `host:port` of the Firebase Auth Emulator (development only).
  final String? authEmulatorHost;
  final String? staffDashboardUrl;
  final String? adminPortalUrl;

  /// Release builds must point at real services: no emulator, no demo
  /// project, no plain-http or localhost API.
  void validate({required bool isRelease}) {
    if (!isRelease) return;
    final problems = <String>[
      if (authEmulatorHost != null) 'FIREBASE_AUTH_EMULATOR_HOST must not be set in release builds',
      if (firebaseProjectId.startsWith('demo-')) 'FIREBASE_PROJECT_ID must be a real project in release builds',
      if (!apiUrl.startsWith('https://')) 'API_URL must use https in release builds',
      if (apiUrl.contains('localhost') || apiUrl.contains('127.0.0.1')) 'API_URL must not be localhost in release builds',
    ];
    if (problems.isNotEmpty) throw StateError('Invalid release configuration: ${problems.join('; ')}');
  }
}
