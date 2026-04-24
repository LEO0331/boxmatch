import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/seo/seo_meta_service.dart';
import '../core/theme/app_theme.dart';
import 'app_dependencies.dart';
import 'app_router.dart';
import 'app_scope.dart';

class BoxmatchApp extends StatefulWidget {
  const BoxmatchApp({required this.dependencies, super.key});

  final AppDependencies dependencies;

  @override
  State<BoxmatchApp> createState() => _BoxmatchAppState();
}

class _BoxmatchAppState extends State<BoxmatchApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _router = buildRouter();
    _router.routerDelegate.addListener(_syncSeoMeta);
    widget.dependencies.localeController.addListener(_syncSeoMeta);
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncSeoMeta());
  }

  @override
  void dispose() {
    _router.routerDelegate.removeListener(_syncSeoMeta);
    widget.dependencies.localeController.removeListener(_syncSeoMeta);
    super.dispose();
  }

  void _syncSeoMeta() {
    final uri = _currentRouterUri();
    SeoMetaService.updateForPath(
      path: uri.path.isEmpty ? '/' : uri.path,
      isZhTw: widget.dependencies.localeController.isZhTw,
    );
  }

  Uri _currentRouterUri() {
    try {
      final info = _router.routeInformationProvider.value;
      final dynamic uri = info.uri;
      if (uri is Uri) {
        return uri;
      }
    } catch (_) {
      // fall through
    }

    final fragment = Uri.base.fragment;
    if (fragment.isNotEmpty) {
      final normalized = fragment.startsWith('/') ? fragment : '/$fragment';
      return Uri.parse(normalized);
    }
    return Uri.parse('/');
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.dependencies.localeController,
      builder: (context, _) {
        return AppScope(
          dependencies: widget.dependencies,
          child: MaterialApp.router(
            title: 'Boxmatch',
            theme: buildAppTheme(),
            routerConfig: _router,
          ),
        );
      },
    );
  }
}
