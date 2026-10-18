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
      child: const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3)),
    ),
  );
}

/// Placeholder rows while a list loads: a calm pulse, no shimmer.
class SkeletonList extends StatefulWidget {
  const SkeletonList({super.key, required this.label, this.count = 5, this.header = true});
  final String label;
  final int count;
  final bool header;

  @override
  State<SkeletonList> createState() => _SkeletonListState();
}

class _SkeletonListState extends State<SkeletonList> with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Widget _bar(double width, double height) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(color: ServeColors.surfaceMuted, borderRadius: BorderRadius.circular(6)),
  );

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.label,
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: Tween(begin: 0.55, end: 1.0).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
          child: ListView(
            physics: const NeverScrollableScrollPhysics(),
            padding: const EdgeInsets.all(ServeSpace.page),
            children: [
              if (widget.header) ...[_bar(180, 26), const SizedBox(height: 10), _bar(240, 14), const SizedBox(height: 24)],
              for (var i = 0; i < widget.count; i++)
                Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ServeColors.white,
                    borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
                    border: Border.all(color: ServeColors.line),
                  ),
                  child: Row(
                    children: [
                      _bar(64, 64),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [_bar(160, 14), const SizedBox(height: 8), _bar(110, 12), const SizedBox(height: 8), _bar(50, 12)],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
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
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(color: ServeColors.oliveTint, shape: BoxShape.circle),
                child: Icon(icon, color: ServeColors.oliveInk, size: 32),
              ),
              const SizedBox(height: 18),
              Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
              if (body != null) ...[
                const SizedBox(height: 6),
                Text(
                  body!,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted),
                ),
              ],
              if (action != null) ...[const SizedBox(height: 22), action!],
            ],
          ),
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
      body: network ? 'Check your connection, then try again.' : null,
      action: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(168, 48)),
        onPressed: onRetry,
        icon: const Icon(Icons.refresh_rounded),
        label: const Text('Try again'),
      ),
    );
  }
}

enum NoticeTone { info, warning, danger }

/// Inline notice strip. Tone is carried by the icon and wording too, never
/// colour alone.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.message,
    this.icon = Icons.info_outline_rounded,
    this.danger = false,
    this.tone = NoticeTone.warning,
  });
  final String message;
  final IconData icon;
  final bool danger;
  final NoticeTone tone;

  @override
  Widget build(BuildContext context) {
    final effective = danger ? NoticeTone.danger : tone;
    final (bg, fg) = switch (effective) {
      NoticeTone.info => (ServeColors.oliveTint, ServeColors.oliveInk),
      NoticeTone.warning => (ServeColors.orangeTint, ServeColors.orangeInk),
      NoticeTone.danger => (ServeColors.dangerTint, ServeColors.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(ServeSpace.radiusControl)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: fg, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: fg, fontWeight: FontWeight.w600, height: 1.35),
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
