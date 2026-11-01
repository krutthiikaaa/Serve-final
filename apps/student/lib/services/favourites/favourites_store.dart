import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists favourite menu-item IDs on the device. Survives sign-out.
abstract class FavouritesStore {
  Future<Set<String>> read();
  Future<void> write(Set<String> ids);
}

class MemoryFavouritesStore implements FavouritesStore {
  MemoryFavouritesStore([Set<String>? seed]) : value = {...?seed};
  Set<String> value;

  @override
  Future<Set<String>> read() async => {...value};

  @override
  Future<void> write(Set<String> ids) async => value = {...ids};
}

/// Reuses the existing secure-storage plugin so we do not add a dependency.
class SecureFavouritesStore implements FavouritesStore {
  SecureFavouritesStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'serve.favourites';

  @override
  Future<Set<String>> read() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null || raw.isEmpty) return {};
      final parsed = jsonDecode(raw);
      if (parsed is! List) return {};
      return {for (final id in parsed) if (id is String && id.isNotEmpty) id};
    } catch (_) {
      return {};
    }
  }

  @override
  Future<void> write(Set<String> ids) => _storage.write(key: _key, value: jsonEncode(ids.toList()));
}
