import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import 'app_dependencies.dart';
import 'app_router.dart';
import 'app_scope.dart';

class BoxmatchApp extends StatelessWidget {
  BoxmatchApp({required this.dependencies, super.key});

  final AppDependencies dependencies;
  final _router = buildRouter();

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: dependencies.localeController,
      builder: (context, _) {
        return AppScope(
          dependencies: dependencies,
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
