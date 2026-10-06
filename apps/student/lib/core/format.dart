import 'package:intl/intl.dart';

final _rupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _rupeesWithPaise = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

/// Integer paise → "₹120" or "₹99.50". Display only: totals come from the backend.
String formatRupees(int paise) => paise % 100 == 0 ? _rupees.format(paise ~/ 100) : _rupeesWithPaise.format(paise / 100);

String formatTime(DateTime at) => DateFormat('h:mm a').format(at.toLocal());

String formatDateTime(DateTime at) => DateFormat('d MMM, h:mm a').format(at.toLocal());

String timeAgo(DateTime at, {DateTime? now}) {
  final diff = (now ?? DateTime.now()).difference(at);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  return formatDateTime(at);
}
