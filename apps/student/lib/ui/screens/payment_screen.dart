import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/demo_qr.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';
import 'order_confirmation_screen.dart';
import 'order_tracking_screen.dart';

/// Manual UPI checkout. The student never confirms payment; the cashier does.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.order, this.quotedTotalPaise});
  final StudentOrder order;
  final int? quotedTotalPaise;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> with WidgetsBindingObserver, LiveReload {
  late StudentOrder _order = widget.order;
  CanteenPaymentConfig? _config;
  Object? _error;
  bool _busy = false;
  final _utr = TextEditingController();

  @override
  Duration? get livePollInterval => const Duration(seconds: 12);

  @override
  void initState() {
    super.initState();
    startLive();
    _utr.text = _order.payment?.utr ?? '';
    _loadConfig();
    // Join this canteen's public room so a replaced QR arrives live.
    context.read<RealtimeService>().subscribeMenu(_order.canteen.id);
  }

  /// Leaves the payment screen exactly once, replacing THIS screen's route.
  ///
  /// `Navigator.pushReplacement` would replace whatever route is on top, so a
  /// payment screen that is no longer on top (or was already replaced and is
  /// waiting to be disposed) could swap the tracking screen for a new
  /// confirmation on every later order event. Live updates stop first.
  bool _leaving = false;

  void _leaveTo(Widget next) {
    if (_leaving || !mounted) return;
    final route = ModalRoute.of(context);
    if (route == null || !route.isCurrent) return;
    _leaving = true;
    stopLive();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !route.isActive) return;
      Navigator.of(context).replace(oldRoute: route, newRoute: serveRoute<void>(next));
    });
  }

  @override
  void dispose() {
    _utr.dispose();
    super.dispose();
  }

  /// Always the order's own canteen, read fresh (never a cached or other QR).
  Future<void> _loadConfig() async {
    try {
      final config = await context.read<ServeApi>().orderPaymentConfig(_order.id);
      if (mounted) setState(() => _config = config);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _refreshOrder() async {
    try {
      final order = await context.read<ServeApi>().order(_order.id);
      if (!mounted) return;
      _apply(order);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _apply(StudentOrder order) {
    setState(() {
      _order = order;
      _error = null;
    });
    if (order.payment?.isSuccess == true) _leaveTo(OrderConfirmationScreen(order: order));
  }

  @override
  void onReconnect() {
    _refreshOrder();
    _loadConfig();
  }

  @override
  void onLiveEvent(RealtimeEvent event) {
    if (event.type == 'canteen.payment_qr_updated' && event.data['canteenId'] == _order.canteen.id) {
      _loadConfig();
      return;
    }
    if (!event.type.startsWith('order.') || event.orderId != _order.id) return;
    final raw = event.data['order'];
    if (raw is Map) _apply(StudentOrder.fromJson(raw.cast<String, dynamic>()));
  }

  Future<void> _claim() async {
    final utr = _utr.text.trim();
    if (_config?.isDemo != true && utr.isEmpty) {
      setState(() => _error = 'Enter the UPI reference after you pay.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = await context.read<ServeApi>().claimPayment(_order.id, utr: utr.isEmpty ? null : utr);
      if (!mounted) return;
      setState(() {
        _order = order;
        _busy = false;
      });
      showSnack(context, 'Reference saved. Payment is still pending cashier confirmation.');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'ALREADY_PAID') {
        await _refreshOrder();
      } else {
        setState(() => _error = e.userMessage);
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    final config = _config;
    final changed = widget.quotedTotalPaise != null && widget.quotedTotalPaise != order.totalPaise;
    final demo = config?.isDemo == true;
    final live = config?.mode == PaymentMode.live;
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
                child: Column(
                  children: [
                    Text('Amount to pay', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                    const SizedBox(height: 6),
                    Text(
                      formatRupees(order.totalPaise),
                      style: const TextStyle(fontSize: 42, fontWeight: FontWeight.w800, letterSpacing: -0.5),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Order ${order.orderNumber} · ${order.canteen.name}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w600),
                    ),
                    if ((order.canteen.type ?? order.servicePeriod) != null) ...[
                      const SizedBox(height: 8),
                      CanteenTypeChip(type: (order.canteen.type ?? order.servicePeriod)!),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            const NoticeBanner(
              message: 'PAYMENT PENDING. Submitting a reference does not confirm payment.',
              icon: Icons.hourglass_top_rounded,
            ),
            if (changed) ...[
              const SizedBox(height: 12),
              const NoticeBanner(message: 'A price changed since your cart was quoted. This is the confirmed total.'),
            ],
            if (demo) ...[
              const SizedBox(height: 16),
              NoticeBanner(
                message: 'Test mode. This is not a real payment, and scanning the placeholder QR will not transfer money.',
                icon: Icons.science_outlined,
              ),
              const SizedBox(height: 16),
              if (config?.demoQr != null)
                DemoQrView(demo: config!.demoQr!)
              else
                const NoticeBanner(
                  danger: true,
                  icon: Icons.qr_code_2_rounded,
                  message: 'The payment QR for this canteen is not available right now.',
                ),
            ] else if (live && config?.incomplete == true) ...[
              const SizedBox(height: 16),
              const NoticeBanner(
                danger: true,
                icon: Icons.error_outline_rounded,
                message: 'This canteen is not ready to take payments yet.',
              ),
            ] else if (live) ...[
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      if (config?.merchantName != null)
                        Text(config!.merchantName!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                      if (config?.upiVpa != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          config!.upiVpa!,
                          style: const TextStyle(fontWeight: FontWeight.w700, color: ServeColors.oliveInk),
                        ),
                      ],
                      const SizedBox(height: 12),
                      if (config?.qr != null || config?.qrImageUrl != null)
                        Image.network(
                          // Each upload has its own URL, so this is always the latest QR.
                          config!.qr != null ? context.read<ServeApi>().assetUrl(config.qr!.url) : config.qrImageUrl!,
                          key: ValueKey<String>(config.qr?.id ?? config.qrImageUrl!),
                          height: 196,
                          width: 196,
                          semanticLabel: 'Payment QR for ${config.canteen?.name ?? order.canteen.name}',
                          errorBuilder: (_, _, _) => const Padding(
                            padding: EdgeInsets.all(12),
                            child: Text('The QR image could not be loaded. Pull to retry or pay at the counter.'),
                          ),
                        )
                      else
                        const NoticeBanner(
                          danger: true,
                          icon: Icons.qr_code_2_rounded,
                          message: 'The payment QR for this canteen is not available right now.',
                        ),
                      const SizedBox(height: 12),
                      const Text(
                        'Pay this amount in your UPI app, then enter the UPI reference below. SERVE will not confirm the payment until a cashier verifies the credit.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: ServeColors.muted, height: 1.4),
                      ),
                      if (config?.instructions != null) ...[
                        const SizedBox(height: 8),
                        Text(config!.instructions!, textAlign: TextAlign.center, style: const TextStyle(height: 1.4)),
                      ],
                    ],
                  ),
                ),
              ),
            ] else if (_error != null && config == null) ...[
              const SizedBox(height: 16),
              NoticeBanner(danger: true, icon: Icons.error_outline_rounded, message: errorMessage(_error!)),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: _loadConfig, child: const Text('Try again')),
            ] else ...[
              const SizedBox(height: 16),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: LoadingView(label: 'Loading payment details'),
              ),
            ],
            const SizedBox(height: 18),
            FieldLabel(text: demo ? 'Optional reference' : 'UPI reference (UTR)'),
            const SizedBox(height: 8),
            TextField(
              key: const Key('utr-field'),
              controller: _utr,
              enabled: !_busy,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [LengthLimitingTextInputFormatter(64)],
              decoration: InputDecoration(hintText: demo ? 'Optional' : 'Enter the reference after you pay'),
            ),
            const SizedBox(height: 8),
            const Text('Entering a reference does not mark this order as paid.', style: TextStyle(color: ServeColors.muted, fontSize: 13)),
            if (_error is String) ...[
              const SizedBox(height: 14),
              NoticeBanner(message: _error! as String, danger: true, icon: Icons.error_outline_rounded),
            ] else if (_error != null && config != null) ...[
              const SizedBox(height: 14),
              NoticeBanner(message: errorMessage(_error!), danger: true, icon: Icons.error_outline_rounded),
            ],
            const SizedBox(height: 12),
            TextButton(onPressed: _busy ? null : () => backToTab(context, HomeTabs.orders), child: const Text('Pay later from Orders')),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              FilledButton(
                onPressed: _busy || (live && config?.incomplete == true) ? null : _claim,
                child: _busy
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                    : Text(demo ? 'Save reference' : 'Submit UPI reference'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () {
                  Navigator.of(context).pushReplacement(serveRoute(OrderTrackingScreen(orderId: order.id)));
                },
                child: const Text('Track this order'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FieldLabel extends StatelessWidget {
  const FieldLabel({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: Theme.of(context).textTheme.titleSmall);
}
