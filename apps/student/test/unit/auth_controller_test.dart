import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/services/auth/session_store.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart';

void main() {
  late FakeFirebase firebase;
  late MemorySessionStore store;
  late AuthController auth;
  Me Function() me = studentMe;

  setUp(() {
    firebase = FakeFirebase();
    store = MemorySessionStore();
    me = studentMe;
    auth = AuthController(firebase: firebase, store: store)..attach(() async => me());
  });

  test('starts signed out without a saved session', () async {
    await auth.restore();
    expect(auth.status, AuthStatus.signedOut);
  });

  test('restores a saved session by refreshing the token, then loads /me', () async {
    await store.write(const StoredSession(uid: 'u', email: 'asha@example.edu', refreshToken: 'saved'));
    await auth.restore();
    expect(firebase.calls, ['refresh']);
    expect(auth.status, AuthStatus.ready);
    expect(auth.student?.name, 'Asha Rao');
  });

  test('sign-in persists only the refresh token and routes on /me', () async {
    await auth.signIn('asha@example.edu', 'secret');
    expect(store.value?.refreshToken, 'refresh');
    expect(store.value?.toJson().values, isNot(contains('secret')));
    expect(auth.status, AuthStatus.ready);
  });

  test('a 401 from /me signs the user out', () async {
    me = () => throw const ApiException(401, 'AUTH_TOKEN_REVOKED', 'revoked');
    await auth.signIn('asha@example.edu', 'secret');
    expect(auth.status, AuthStatus.signedOut);
    expect(store.value, isNull);
  });

  test('backend outages keep the session and show an error state', () async {
    me = () => throw const ApiException(0, 'NETWORK_ERROR', ApiException.networkMessage);
    await auth.signIn('asha@example.edu', 'secret');
    expect(auth.status, AuthStatus.error);
    expect(auth.isSignedIn, isTrue);
  });

  test('createAccount does not leave the registration screen', () async {
    await auth.createAccount('new@example.edu', 'secret1');
    expect(auth.status, AuthStatus.initializing);
    expect(await auth.idToken(), 'id-token');
  });

  test('concurrent token refreshes share one request', () async {
    await auth.signIn('asha@example.edu', 'secret');
    firebase.calls.clear();
    await Future.wait([auth.idToken(forceRefresh: true), auth.idToken(forceRefresh: true)]);
    expect(firebase.calls, ['refresh']);
  });

  test('sign-out clears everything', () async {
    await auth.signIn('asha@example.edu', 'secret');
    await auth.signOut();
    expect(auth.me, isNull);
    expect(store.value, isNull);
    expect(await auth.idToken(), isNull);
  });
}
