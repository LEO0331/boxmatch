import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

import '../i18n/app_strings.dart';

class AppShell extends StatelessWidget {
  const AppShell({required this.child, required this.state, super.key});

  final Widget child;
  final GoRouterState state;

  int _currentIndex() {
    final location = state.uri.toString();
    if (location.startsWith('/map')) {
      return 1;
    }
    if (location.startsWith('/enterprise/new')) {
      return 2;
    }
    return 0;
  }

  void _navigate(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/');
      case 1:
        context.go('/map');
      case 2:
        context.go('/enterprise/new');
    }
  }

  @override
  Widget build(BuildContext context) {
    final index = _currentIndex();
    final width = MediaQuery.sizeOf(context).width;
    final isWide = width >= 900;
    final useRail = (kIsWeb || isWide) && width >= 760;
    final s = AppStrings.of(context);

    if (useRail) {
      final isCompactRail = width < 1200;
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: index,
              onDestinationSelected: (next) => _navigate(context, next),
              labelType: isCompactRail
                  ? NavigationRailLabelType.selected
                  : NavigationRailLabelType.all,
              destinations: [
                NavigationRailDestination(
                  icon: const Icon(Icons.list_alt_outlined),
                  selectedIcon: const Icon(Icons.list_alt),
                  label: Text(s.navListings),
                ),
                NavigationRailDestination(
                  icon: const Icon(Icons.map_outlined),
                  selectedIcon: const Icon(Icons.map),
                  label: Text(s.navMap),
                ),
                NavigationRailDestination(
                  icon: const Icon(Icons.storefront_outlined),
                  selectedIcon: const Icon(Icons.storefront),
                  label: Text(s.navPost),
                ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (next) => _navigate(context, next),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.list_alt_outlined),
            selectedIcon: const Icon(Icons.list_alt),
            label: s.navListings,
          ),
          NavigationDestination(
            icon: const Icon(Icons.map_outlined),
            selectedIcon: const Icon(Icons.map),
            label: s.navMap,
          ),
          NavigationDestination(
            icon: const Icon(Icons.storefront_outlined),
            selectedIcon: const Icon(Icons.storefront),
            label: s.navPost,
          ),
        ],
      ),
    );
  }
}
