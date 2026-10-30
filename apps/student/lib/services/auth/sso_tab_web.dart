// dart:html is the supported popup-tab API on Flutter web.
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;

import 'sso_tab.dart';

class _HtmlSsoTab implements SsoTab {
  _HtmlSsoTab(this._window);
  final html.WindowBase _window;

  @override
  void open(String url) => _window.location.href = url;

  @override
  void close() => _window.close();
}

SsoTab? openBlankSsoTab() {
  final opened = html.window.open('about:blank', '_blank');
  if (opened.closed == true) return null;
  return _HtmlSsoTab(opened);
}
