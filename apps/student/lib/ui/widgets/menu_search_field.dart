import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

class MenuSearchField extends StatelessWidget {
  const MenuSearchField({super.key, required this.controller, required this.onChanged, this.focusNode, this.autofocus = false});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final FocusNode? focusNode;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      autofocus: autofocus,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Search this menu',
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                onPressed: () {
                  controller.clear();
                  onChanged('');
                },
                icon: const Icon(Icons.close_rounded),
              ),
        filled: true,
        fillColor: ServeColors.white,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ServeSpace.radiusControl),
          borderSide: const BorderSide(color: ServeColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ServeSpace.radiusControl),
          borderSide: const BorderSide(color: ServeColors.oliveStrong, width: 2),
        ),
      ),
    );
  }
}
