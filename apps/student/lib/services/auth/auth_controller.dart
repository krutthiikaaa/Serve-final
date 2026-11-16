import 'package:flutter/foundation.dart';

import '../../core/api_exception.dart';
import '../api/models.dart';
import 'platform_auth.dart';
import 'serve_auth_client.dart';
import 'session_store.dart';

enum AuthStatus { initializing, signedOut, loadingAccount, ready, error }

/// Loads `/api/auth/me` for the signed-in identity.
typedef MeLoader = Future<Me> Function();

/// Google (Better Auth, @srmap.edu.in only) proves identity; the backend
/// decides the role. This controller keeps both in one state machine:
/// initializing → signedOut | loadingAccount → ready | error.
///
/// Web: the session is the backend's HttpOnly cookie (nothing stored here).
/// Android / iOS: the session token, kept in secure storage, sent as Bearer.
class AuthController extends ChangeNotifier {
  AuthController({required this._client, required this._store, bool? isWeb}) : _isWeb = isWeb ?? kIsWeb;

  final ServeAuthClient _client;
  final SessionStore _store;
  final bool _isWeb;
  late MeLoader _loadMe;

  AuthStatus status = AuthStatus.initializing;
  String? _token;
  bool _webSession = false;
  Me? me;
  Object? error;

  /// Why the last Google sign-in was refused (shown on the sign-in screen).
  String? signInError;

  String? get email => switch (me) {
    UnregisteredMe(:final email) => email,
    StudentMe(:final email) => email,
    _ => null,
  };
  bool get isSignedIn => _isWeb ? _webSession : _token != null;
  StudentMe? get student => me is StudentMe ? me! as StudentMe : null;

  /// Wired after the API client exists (the client needs [sessionToken]).
  void attach(MeLoader loadMe) => _loadMe = loadMe;

  /// Restores the session on app start (and after returning from Google on web).
  Future<void> restore() async {
    if (_isWeb) {
      final refused = PlatformAuth.takeSignInError();
      if (refused != null) signInError = signInErrorMessage(refused);
      // The cookie, if any, is sent with /me; 401 means signed out.
      _webSession = true;
      return refreshMe();
    }
    final stored = await _store.read();
    if (stored == null) return _set(AuthStatus.signedOut);
    _token = stored.token;
    await refreshMe();
  }

  /// Google sign-in. On web the page leaves for Google and the app restarts
  /// signed in; natively the system browser returns the session here.
  Future<void> signInWithGoogle() async {
    signInError = null;
    notifyListeners();
    try {
      if (_isWeb) {
        final root = PlatformAuth.webAppRoot()!;
        await PlatformAuth.navigateTo(await _client.webSignInUrl(root));
        return;
      }
      _token = await _client.nativeSignIn();
      await _store.write(StoredSession(token: _token!));
      await refreshMe();
    } on AuthException catch (e) {
      signInError = e.message;
      notifyListeners();
      if (e.code == 'network-request-failed') rethrow;
    }
  }

  Future<void> signOut() async {
    final token = _token;
    _token = null;
    _webSession = false;
    me = null;
    error = null;
    await _store.clear();
    _set(AuthStatus.signedOut);
    await _client.signOut(token: token);
  }

  /// Re-reads `/api/auth/me` (after registration, reconnects, retries).
  Future<void> refreshMe() async {
    if (!isSignedIn) return _set(AuthStatus.signedOut);
    if (status != AuthStatus.ready) _set(AuthStatus.loadingAccount);
    try {
      me = await _loadMe();
      error = null;
      _set(AuthStatus.ready);
    } on ApiException catch (e) {
      if (e.status == 401) {
        // No (or an ended) session: signed out, quietly.
        _token = null;
        _webSession = false;
        me = null;
        await _store.clear();
        return _set(AuthStatus.signedOut);
      }
      error = e;
      _set(AuthStatus.error);
    }
  }

  /// The native app's session token for `Authorization: Bearer` (null on web,
  /// where the cookie is sent instead).
  Future<String?> sessionToken({bool forceRefresh = false}) async => _token;

  void setMe(Me value) {
    me = value;
    _set(AuthStatus.ready);
  }

  void _set(AuthStatus next) {
    status = next;
    notifyListeners();
  }
}
