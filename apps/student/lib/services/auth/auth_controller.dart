import 'package:flutter/foundation.dart';

import '../../core/api_exception.dart';
import '../api/models.dart';
import 'firebase_auth_client.dart';
import 'session_store.dart';

enum AuthStatus { initializing, signedOut, loadingAccount, ready, error }

/// Loads `/api/auth/me` for the signed-in Firebase user.
typedef MeLoader = Future<Me> Function();

/// Firebase proves identity; the backend decides the role. This controller
/// keeps both in one state machine:
/// initializing → signedOut | loadingAccount → ready | error.
class AuthController extends ChangeNotifier {
  AuthController({required this._firebase, required this._store, DateTime Function()? clock}) : _now = clock ?? DateTime.now;

  final FirebaseAuthClient _firebase;
  final SessionStore _store;
  final DateTime Function() _now;
  late MeLoader _loadMe;

  AuthStatus status = AuthStatus.initializing;
  FirebaseSession? _session;
  Me? me;
  Object? error;
  Future<FirebaseSession>? _refreshing;

  String? get email => _session?.email;
  bool get isSignedIn => _session != null;
  StudentMe? get student => me is StudentMe ? me! as StudentMe : null;

  /// Wired after the API client exists (the client needs [idToken]).
  void attach(MeLoader loadMe) => _loadMe = loadMe;

  /// Restores a persisted session on app start.
  Future<void> restore() async {
    final stored = await _store.read();
    if (stored == null) return _set(AuthStatus.signedOut);
    try {
      _session = await _firebase.refresh(
        FirebaseSession(uid: stored.uid, email: stored.email, idToken: '', refreshToken: stored.refreshToken, expiresAt: _now()),
      );
      await _persist();
      await refreshMe();
    } on AuthException catch (e) {
      if (e.code == 'network-request-failed') {
        error = e;
        _session = FirebaseSession(uid: stored.uid, email: stored.email, idToken: '', refreshToken: stored.refreshToken, expiresAt: _now());
        return _set(AuthStatus.error);
      }
      await signOut();
    }
  }

  Future<void> signIn(String email, String password) async {
    _session = await _firebase.signIn(email, password);
    await _persist();
    await refreshMe();
  }

  /// Creates the Firebase account without leaving the registration screen:
  /// the caller registers with SERVE next and then calls [setMe]. If that
  /// step is abandoned, the next sign-in lands on "complete registration".
  Future<void> createAccount(String email, String password) async {
    _session = await _firebase.signUp(email, password);
    await _persist();
  }

  Future<void> signOut() async {
    _session = null;
    me = null;
    error = null;
    await _store.clear();
    _set(AuthStatus.signedOut);
  }

  /// Re-reads `/api/auth/me` (after registration, reconnects, retries).
  Future<void> refreshMe() async {
    if (_session == null) return _set(AuthStatus.signedOut);
    if (status != AuthStatus.ready) _set(AuthStatus.loadingAccount);
    try {
      if (_session!.idToken.isEmpty) await idToken(forceRefresh: true);
      me = await _loadMe();
      error = null;
      _set(AuthStatus.ready);
    } on ApiException catch (e) {
      if (e.status == 401) return signOut();
      error = e;
      _set(AuthStatus.error);
    } on AuthException catch (e) {
      error = e;
      _set(AuthStatus.error);
    }
  }

  /// A valid ID token, refreshed shortly before expiry or on demand.
  Future<String?> idToken({bool forceRefresh = false}) async {
    final session = _session;
    if (session == null) return null;
    if (!forceRefresh && session.idToken.isNotEmpty && !session.expiresWithin(const Duration(minutes: 2), _now())) {
      return session.idToken;
    }
    // Concurrent callers share one refresh.
    final refreshing = _refreshing ??= _firebase.refresh(session);
    try {
      _session = await refreshing;
      await _persist();
      return _session!.idToken;
    } on AuthException catch (e) {
      if (e.code != 'network-request-failed') await signOut();
      rethrow;
    } finally {
      _refreshing = null;
    }
  }

  void setMe(Me value) {
    me = value;
    _set(AuthStatus.ready);
  }

  Future<void> _persist() async {
    final s = _session;
    if (s != null) await _store.write(StoredSession(uid: s.uid, email: s.email, refreshToken: s.refreshToken));
  }

  void _set(AuthStatus next) {
    status = next;
    notifyListeners();
  }
}
