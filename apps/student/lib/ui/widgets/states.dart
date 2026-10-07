import 'package:flutter/material.dart';

import '../../core/api_exception.dart';
import '../../theme/serve_theme.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label = 'Loading'});
  final String label;

  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: label,
      child: const CircularProgressIndicator(color: ServeColors.olive),
    ),
  );
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(color: ServeColors.oliveTint, shape: BoxShape.circle),
              child: Icon(icon, color: ServeColors.oliveDark, size: 30),
            ),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            if (body != null) ...[
              const SizedBox(height: 6),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final network = error is ApiException && (error as ApiException).isNetwork;
    return EmptyView(
      icon: network ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: errorMessage(error),
      action: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(160, 48)),
        onPressed: onRetry,
        icon: const Icon(Icons.refresh_rounded),
        label: const Text('Try again'),
      ),
    );
  }
}

/// Inline error/notice strip.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({super.key, required this.message, this.icon = Icons.info_outline_rounded, this.danger = false});
  final String message;
  final IconData icon;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? ServeColors.danger : const Color(0xFF8A3A12);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: danger ? ServeColors.dangerTint : ServeColors.orangeTint, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Icon(icon, color: fg, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: fg, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
