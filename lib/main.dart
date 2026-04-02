import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'app/app.dart';
import 'app/app_bootstrap.dart';

void _logGlobalError({
  required String source,
  required Object error,
  StackTrace? stackTrace,
  bool fatal = false,
}) {
  final payload = <String, dynamic>{
    'tag': 'BOXMATCH_ERROR',
    'source': source,
    'fatal': fatal,
    'errorType': error.runtimeType.toString(),
    'message': error.toString(),
    'stackTrace': stackTrace?.toString(),
    'ts': DateTime.now().toIso8601String(),
  };
  final line = jsonEncode(payload);
  debugPrint(line);
  developer.log(line, name: 'BOXMATCH_ERROR');
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    _logGlobalError(
      source: 'flutter_error',
      error: details.exception,
      stackTrace: details.stack,
      fatal: true,
    );
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    _logGlobalError(
      source: 'platform_dispatcher',
      error: error,
      stackTrace: stack,
      fatal: true,
    );
    return true;
  };

  await runZonedGuarded<Future<void>>(
    () async {
      final dependencies = await bootstrapApp();
      runApp(BoxmatchApp(dependencies: dependencies));
    },
    (error, stack) {
      _logGlobalError(
        source: 'run_zoned_guarded',
        error: error,
        stackTrace: stack,
        fatal: true,
      );
    },
  );
}
