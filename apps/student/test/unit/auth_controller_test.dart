import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/services/auth/session_store.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart';

void main() {
  late FakeAuthClient google;
  late MemorySessionStore store;
  late AuthController auth;
  Me Function() me = studentMe;

  setUp(() {
    google = FakeAuthClient();
    store = MemorySessionStore();
    me = studentMe;
    auth = AuthController(client: google, store: store, isWeb: false)..attach(() async => me());
  });

  test('starts signed out without a saved session', () async {
    await auth.restore();
    expect(auth.status, AuthStatus.signedOut);
  });

  test('restores a saved session token, then loads /me', () async {
    store.value = const StoredSession(token: 'saved-token');
    await auth.restore();
    expect(auth.status, AuthStatus.ready);
    expect(await auth.sessionToken(), 'saved-token');
    expect(google.calls, isEmpty, reason: 'no browser sign-in on restore');
  });

  test('Google sign-in stores only the session token and routes on /me', () async {
    await auth.signInWithGoogle();
    expect(store.value?.token, 'session-token');
    expect(auth.status, AuthStatus.ready);
    expect(auth.student?.firstName, 'Asha');
    expect(auth.signInError, isNull);
  });

  test('a refused Google account is explained and nothing is stored', () async {
    google.signInError = const AuthException('EMAIL_DOMAIN_NOT_ALLOWED', 'Use your SRM University-AP Google account (@srmap.edu.in).');
    await auth.signInWithGoogle();
    expect(auth.signInError, contains('@srmap.edu.in'));
    expect(store.value, isNull);
    expect(auth.isSignedIn, isFalse);
  });

  test('a 401 from /me (session ended) signs the user out and forgets the token', () async {
    store.value = const StoredSession(token: 'ended');
    me = () => throw const ApiException(401, 'AUTH_REQUIRED', 'x');
    await auth.restore();
    expect(auth.status, AuthStatus.signedOut);
    expect(store.value, isNull);
  });

  test('backend outages keep the session and show an error state', () async {
    store.value = const StoredSession(token: 'kept');
    me = () => throw const ApiException(0, 'NETWORK_ERROR', 'down');
    await auth.restore();
    expect(auth.status, AuthStatus.error);
    expect(store.value?.token, 'kept');
  });

  test('a stored pre-Better-Auth (Firebase) session is ignored', () async {
    expect(StoredSession.fromJson({'uid': 'u', 'email': 'e', 'refreshToken': 'r'}), isNull);
    expect(StoredSession.fromJson({'v': 2, 'token': 't'})?.token, 't');
  });

  test('sign-out ends the server session and clears everything', () async {
    await auth.signInWithGoogle();
    await auth.signOut();
    expect(auth.status, AuthStatus.signedOut);
    expect(auth.me, isNull);
    expect(store.value, isNull);
    expect(await auth.sessionToken(), isNull);
    expect(google.calls.last, 'signOut:session-token');
  });
}
