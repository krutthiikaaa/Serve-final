import 'sso_tab_stub.dart' if (dart.library.html) 'sso_tab_web.dart' as platform;

/// A browser tab opened synchronously so popup blockers do not eat the SSO handoff.
abstract interface class SsoTab {
  void open(String url);
  void close();
}

SsoTab? openBlankSsoTab() => platform.openBlankSsoTab();
