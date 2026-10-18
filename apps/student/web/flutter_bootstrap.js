{{flutter_js}}
{{flutter_build_config}}

// SERVE loads without Flutter's deprecated service worker. On the single
// domain the student app owns the root scope (/), so a worker there would
// also sit in front of /staff/, /admin/ and /api, and could keep serving an
// old build after a deploy. Ordering needs a connection anyway.
_flutter.loader.load();
