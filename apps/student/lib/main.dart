import 'package:flutter/material.dart';

import 'app.dart';
import 'config/app_config.dart';
import 'services/api/api_client.dart';
import 'services/api/serve_api.dart';
import 'services/auth/auth_controller.dart';
import 'services/auth/platform_auth.dart';
import 'services/auth/serve_auth_client.dart';
import 'services/auth/session_store.dart';
import 'services/favourites/favourites_store.dart';
import 'services/realtime/realtime_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  // Web: sends the SERVE session cookie. Native: a plain client (Bearer token).
  final http = PlatformAuth.httpClient();
  final auth = AuthController(
    client: ServeAuthClient(config, httpClient: http),
    store: SecureSessionStore(),
  );
  // Any 401 or realtime `auth.expired` re-checks the session (signs out with
  // "Your session expired" when it has ended).
  final api = ServeApi(
    ApiClient(baseUrl: config.apiUrl, token: auth.sessionToken, httpClient: http, onUnauthorized: () => auth.sessionEnded()),
  );
  auth.attach(api.me);
  final realtime = SocketRealtimeService(url: config.apiUrl, token: auth.sessionToken, onSessionEnded: () => auth.sessionEnded());
  runApp(
    ServeApp(
      services: AppServices(config: config, auth: auth, api: api, realtime: realtime, favouritesStore: SecureFavouritesStore()),
    ),
  );
  // The logo splash plays while any saved session is restored.
  await auth.restore();
}
