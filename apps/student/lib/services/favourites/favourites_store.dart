import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists favourite menu-item IDs on the device, per SERVE account, so a
/// student never sees the favourites of someone who used the device before.
/// Survives sign-out (the same student finds them again on sign-in).
abstract class FavouritesStore {
  Future<Set<String>> read(String account);
  Future<void> write(String account, Set<String> ids);
}

class MemoryFavouritesStore implements FavouritesStore {
  /// [seed] is stored for [seedAccount].
  MemoryFavouritesStore([Set<String>? seed, String seedAccount = 'student']) {
    if (seed != null) values[seedAccount] = {...seed};
  }

  final Map<String, Set<String>> values = {};

  @override
  Future<Set<String>> read(String account) async => {...?values[account]};

  @override
  Future<void> write(String account, Set<String> ids) async => values[account] = {...ids};
}

/// Reuses the existing secure-storage plugin so we do not add a dependency.
class SecureFavouritesStore implements FavouritesStore {
  SecureFavouritesStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;

  /// Before favourites were per account, one list was shared by everyone on
  /// the device. It cannot be attributed to a student, so it is dropped.
  static const _legacyKey = 'serve.favourites';
  static String _key(String account) => 'serve.favourites.$account';
  bool _legacyDropped = false;

  @override
  Future<Set<String>> read(String account) async {
    try {
      await _dropLegacy();
      final raw = await _storage.read(key: _key(account));
      if (raw == null || raw.isEmpty) return {};
      final parsed = jsonDecode(raw);
      if (parsed is! List) return {};
      return {
        for (final id in parsed)
          if (id is String && id.isNotEmpty) id,
      };
    } catch (_) {
      return {};
    }
  }

  @override
  Future<void> write(String account, Set<String> ids) => _storage.write(key: _key(account), value: jsonEncode(ids.toList()));

  Future<void> _dropLegacy() async {
    if (_legacyDropped) return;
    _legacyDropped = true;
    await _storage.delete(key: _legacyKey);
  }
}
