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
    String apiUrl = const String.fromEnvironment('API_URL');
    String apiKey = const String.fromEnvironment('FIREBASE_API_KEY', defaultValue: 'demo-api-key');
    String projectId = const String.fromEnvironment('FIREBASE_PROJECT_ID', defaultValue: 'demo-serve');
    String emulator = const String.fromEnvironment('FIREBASE_AUTH_EMULATOR_HOST');
    String staffUrl = const String.fromEnvironment('STAFF_DASHBOARD_URL');
    String adminUrl = const String.fromEnvironment('ADMIN_PORTAL_URL');

    final isRelease = const bool.fromEnvironment('dart.vm.product');

    if (!isRelease) {
      if (emulator.isEmpty) {
        emulator = kIsWeb || defaultTargetPlatform != TargetPlatform.android 
            ? '127.0.0.1:9099' 
            : '10.0.2.2:9099';
      }
      if (apiUrl.isEmpty) {
        apiUrl = kIsWeb || defaultTargetPlatform != TargetPlatform.android
            ? 'http://127.0.0.1:5001'
            : 'http://10.0.2.2:5001';
      }
    } else {
      if (apiUrl.isEmpty) apiUrl = 'http://localhost:5001'; // Fallback for release without API_URL, though it should fail validation
    }

    final config = AppConfig(
      apiUrl: apiUrl.endsWith('/') ? apiUrl.substring(0, apiUrl.length - 1) : apiUrl,
      firebaseApiKey: apiKey,
      firebaseProjectId: projectId,
      authEmulatorHost: emulator.isEmpty ? null : emulator,
      staffDashboardUrl: staffUrl.isEmpty ? null : staffUrl,
      adminPortalUrl: adminUrl.isEmpty ? null : adminUrl,
    );
    config.validate(isRelease: const bool.fromEnvironment('dart.vm.product'));
    return config;
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
