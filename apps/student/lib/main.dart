import 'package:flutter/material.dart';

import 'app.dart';
import 'config/app_config.dart';
import 'services/api/api_client.dart';
import 'services/api/serve_api.dart';
import 'services/auth/auth_controller.dart';
import 'services/auth/firebase_auth_client.dart';
import 'services/auth/session_store.dart';
import 'services/realtime/realtime_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  final auth = AuthController(firebase: FirebaseAuthClient(config), store: SecureSessionStore());
  final api = ServeApi(ApiClient(baseUrl: config.apiUrl, token: auth.idToken));
  auth.attach(api.me);
  final realtime = SocketRealtimeService(url: config.apiUrl, token: auth.idToken);
  runApp(
    ServeApp(
      services: AppServices(config: config, auth: auth, api: api, realtime: realtime),
    ),
  );
  // Give the splash a brief moment, then restore any saved session.
  await Future<void>.delayed(const Duration(milliseconds: 900));
  await auth.restore();
}
