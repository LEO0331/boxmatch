import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../preferences/app_locale_controller.dart';

class LanguageMenuButton extends StatelessWidget {
  const LanguageMenuButton({super.key});

  @override
  Widget build(BuildContext context) {
    final localeController = AppScope.of(context).localeController;

    return PopupMenuButton<AppLanguage>(
      tooltip: 'Language',
      icon: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.language_outlined),
          const SizedBox(width: 4),
          Text(localeController.languageLabel),
        ],
      ),
      onSelected: localeController.setLanguage,
      itemBuilder: (context) => const [
        PopupMenuItem<AppLanguage>(
          value: AppLanguage.zhTw,
          child: Text('繁體中文'),
        ),
        PopupMenuItem<AppLanguage>(
          value: AppLanguage.en,
          child: Text('English'),
        ),
      ],
    );
  }
}
