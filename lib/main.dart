import 'package:flutter/material.dart';

import 'app/app.dart';
import 'app/app_bootstrap.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final dependencies = await bootstrapApp();
  runApp(BoxmatchApp(dependencies: dependencies));
}
