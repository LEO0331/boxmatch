import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/traffic_admin_api.dart';
import '../models/traffic_overview.dart';
import 'traffic_dashboard_page.dart';
import 'traffic_platform.dart' as platform;

class TrafficAdminEntry extends StatefulWidget {
  const TrafficAdminEntry({
    required this.login,
    required this.apiBaseUrl,
    this.enabled = const bool.fromEnvironment('BOXMATCH_ENABLE_TRAFFIC_ADMIN'),
    this.isZhTw = false,
    this.client,
    this.fixtureLabel,
    this.refreshCooldown = const Duration(seconds: 30),
    this.onDownload,
    super.key,
  });
  final bool login, enabled, isZhTw;
  final String apiBaseUrl;
  final TrafficAdminClient? client;
  final String? fixtureLabel;
  final Duration refreshCooldown;
  final bool Function(String filename, String content)? onDownload;

  @override
  State<TrafficAdminEntry> createState() => _TrafficAdminEntryState();
}

class _TrafficAdminEntryState extends State<TrafficAdminEntry> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  TrafficAdminClient? _client;
  TrafficOverview? _overview;
  String? _error;
  bool _initializing = true,
      _loading = false,
      _exporting = false,
      _signingOut = false;
  bool _wasAuthorized = false, _refreshAllowed = true;
  int _days = 7, _epoch = 0;
  Timer? _cooldown;

  String t(String en, String zh) => widget.isZhTw ? zh : en;

  @override
  void initState() {
    super.initState();
    if (widget.enabled) {
      unawaited(_initialize());
    } else {
      _initializing = false;
    }
  }

  Future<void> _initialize() async {
    try {
      final client =
          widget.client ?? await createTrafficAdminClient(widget.apiBaseUrl);
      if (!mounted) {
        if (widget.client == null) client.session.dispose();
        return;
      }
      _client = client;
      _wasAuthorized = client.session.isAuthorized;
      client.session.addListener(_sessionChanged);
      setState(() => _initializing = false);
      if (_wasAuthorized) _whenAuthorized();
    } catch (_) {
      if (mounted) {
        setState(() {
          _initializing = false;
          _error = t(
            'Administrator sign-in is unavailable. Check the configured authentication provider.',
            '管理員登入不可用，請確認驗證供應商設定。',
          );
        });
      }
    }
  }

  void _sessionChanged() {
    if (!mounted) return;
    final authorized = _client!.session.isAuthorized;
    final becameAuthorized = authorized && !_wasAuthorized;
    if (!authorized) {
      if (_wasAuthorized && !_signingOut) {
        _error = t(
          'Your administrator session ended or access was removed. Sign in again.',
          '管理員登入已結束或權限已移除，請重新登入。',
        );
      }
      _epoch++;
      _overview = null;
      _loading = false;
      _exporting = false;
      _cooldown?.cancel();
      _refreshAllowed = true;
    }
    _wasAuthorized = authorized;
    setState(() {});
    if (becameAuthorized) _whenAuthorized();
  }

  void _whenAuthorized() {
    if (widget.login && GoRouter.maybeOf(context) != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _client?.session.isAuthorized == true) {
          context.go('/admin/traffic');
        }
      });
    } else {
      unawaited(_load());
    }
  }

  Future<void> _signIn() async {
    final session = _client?.session;
    if (session == null || session.isBusy) return;
    setState(() => _error = null);
    try {
      await session.signIn(_email.text.trim(), _password.text);
      _password.clear();
      if (!mounted) return;
      if (!session.isAuthorized) {
        setState(
          () => _error = t(
            'This account does not have traffic administrator access.',
            '此帳號沒有流量管理員權限。',
          ),
        );
      }
    } catch (_) {
      _password.clear();
      if (mounted) {
        setState(
          () => _error = t(
            'Sign-in failed. Check your credentials and account access.',
            '登入失敗，請確認登入資訊與帳號權限。',
          ),
        );
      }
    }
  }

  Future<void> _signOut() async {
    _epoch++;
    _cooldown?.cancel();
    setState(() {
      _overview = null;
      _error = null;
      _signingOut = true;
      _loading = false;
    });
    try {
      await _client?.session.signOut();
    } catch (_) {
      _client?.session.invalidate();
    }
    if (!mounted) return;
    setState(() => _signingOut = false);
    if (!widget.login && GoRouter.maybeOf(context) != null) {
      context.go('/admin/login');
    }
  }

  Future<void> _load() async {
    final client = _client;
    if (client == null || !client.session.isAuthorized || _signingOut) return;
    final epoch = ++_epoch;
    final revision = client.session.revision;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await client.api.overview(_days);
      if (!mounted || epoch != _epoch) return;
      if (!client.session.isAuthorized || revision != client.session.revision) {
        setState(() {
          _loading = false;
          _overview = null;
          _error = t(
            'Your administrator session changed. Refresh to load analytics again.',
            '管理員登入狀態已變更，請重新整理以載入分析資料。',
          );
        });
        return;
      }
      setState(() {
        _overview = result;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _loading = false;
        _error = t(
          'Analytics could not be loaded. The service may be unavailable or its read budget exhausted.',
          '無法載入分析資料，服務可能暫時不可用或已達讀取預算。',
        );
      });
    }
  }

  void _refresh() {
    if (!_refreshAllowed || _loading) return;
    setState(() => _refreshAllowed = false);
    _cooldown?.cancel();
    _cooldown = Timer(widget.refreshCooldown, () {
      if (mounted) setState(() => _refreshAllowed = true);
    });
    unawaited(_load());
  }

  Future<void> _export() async {
    final client = _client;
    if (client == null || !client.session.isAuthorized || _exporting) return;
    final epoch = _epoch;
    final revision = client.session.revision;
    setState(() {
      _exporting = true;
      _error = null;
    });
    try {
      final csv = await client.api.exportCsv(_days);
      if (!mounted ||
          epoch != _epoch ||
          !client.session.isAuthorized ||
          revision != client.session.revision) {
        return;
      }
      final downloaded = (widget.onDownload ?? platform.downloadCsv)(
        csv.filename,
        csv.content,
      );
      if (!downloaded) {
        setState(
          () => _error = t(
            'CSV downloads require a web browser.',
            'CSV 下載需要使用網頁瀏覽器。',
          ),
        );
      }
    } catch (_) {
      if (mounted && epoch == _epoch) {
        setState(
          () => _error = t(
            'CSV export failed. Try again after checking your session.',
            'CSV 匯出失敗，請確認登入狀態後再試。',
          ),
        );
      }
    } finally {
      if (mounted && epoch == _epoch) setState(() => _exporting = false);
    }
  }

  @override
  void dispose() {
    _epoch++;
    _cooldown?.cancel();
    _client?.session.removeListener(_sessionChanged);
    if (widget.client == null) _client?.session.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) {
      return Scaffold(
        body: Center(
          child: Text(t('Administrator interface is disabled.', '管理員介面未啟用。')),
        ),
      );
    }
    if (_initializing || _signingOut) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final authorized = _client?.session.isAuthorized == true;
    if (authorized && _overview != null) {
      return TrafficDashboardPage(
        overview: _overview!,
        isZhTw: widget.isZhTw,
        days: _days,
        loading: _loading,
        exporting: _exporting,
        refreshAllowed: _refreshAllowed,
        fixtureLabel: widget.fixtureLabel,
        error: _error,
        onDaysChanged: (value) {
          setState(() {
            _days = value;
            _overview = null;
          });
          unawaited(_load());
        },
        onRefresh: _refresh,
        onExport: () => unawaited(_export()),
        onSignOut: () => unawaited(_signOut()),
      );
    }
    if (authorized) {
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_loading) const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(
                    _error ??
                        t('Loading persisted analytics…', '正在載入已儲存的分析資料…'),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  if (!_loading)
                    OutlinedButton(
                      onPressed: _refreshAllowed ? _refresh : null,
                      child: Text(t('Retry', '重試')),
                    ),
                  TextButton(
                    key: const ValueKey('traffic-sign-out'),
                    onPressed: () => unawaited(_signOut()),
                    child: Text(t('Sign out', '登出')),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    final busy = _client?.session.isBusy == true;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      t('Administrator sign-in', '管理員登入'),
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      t(
                        'Traffic analytics only. Your recipient session remains separate.',
                        '僅用於流量分析，不影響您的領取者登入狀態。',
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    TextField(
                      key: const ValueKey('traffic-email'),
                      controller: _email,
                      enabled: !busy && _client != null,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      decoration: InputDecoration(
                        labelText: t('Email', '電子郵件'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      key: const ValueKey('traffic-password'),
                      controller: _password,
                      enabled: !busy && _client != null,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => unawaited(_signIn()),
                      decoration: InputDecoration(
                        labelText: t('Password', '密碼'),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      key: const ValueKey('traffic-sign-in'),
                      onPressed: busy || _client == null
                          ? null
                          : () => unawaited(_signIn()),
                      child: Text(
                        busy ? t('Signing in…', '登入中…') : t('Sign in', '登入'),
                      ),
                    ),
                    if (_client?.session.isAuthenticated == true)
                      TextButton(
                        onPressed: () => unawaited(_signOut()),
                        child: Text(t('Sign out', '登出')),
                      ),
                    const SizedBox(height: 16),
                    Text(
                      t(
                        'Access is limited to administrator accounts approved by an operator.',
                        '僅限經操作人員核准的管理員帳號存取。',
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
