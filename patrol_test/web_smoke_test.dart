import 'package:boxmatch/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

void main() {
  patrolTest('web smoke flow on chrome', ($) async {
    app.main();
    await $.pumpAndTrySettle(timeout: const Duration(seconds: 10));

    final tester = $.tester;
    var homeVisible = false;
    try {
      await $('展場剩食媒合').waitUntilVisible(
        timeout: const Duration(seconds: 20),
      );
      homeVisible = true;
    } catch (_) {
      try {
        await $('Exhibition Surplus Matching').waitUntilVisible(
          timeout: const Duration(seconds: 20),
        );
        homeVisible = true;
      } catch (_) {
        homeVisible = false;
      }
    }
    expect(homeVisible, isTrue, reason: 'Home page title is not visible after launch');

    final launchError = tester.takeException();
    expect(launchError, isNull, reason: 'Unexpected exception during app launch');

    final mapLabels = <String>['地圖', '場館地圖', 'Map', 'Venue map'];
    var mapTapped = false;
    for (final label in mapLabels) {
      try {
        await $(label).tap();
        mapTapped = true;
        break;
      } catch (_) {
        // try next label
      }
    }
    expect(mapTapped, isTrue, reason: 'Cannot find map tab label in current locale');
    await $.pumpAndTrySettle(timeout: const Duration(seconds: 10));

    var mapVisible = false;
    for (final label in <String>['場館地圖', 'Venue map']) {
      try {
        await $(label).waitUntilVisible(timeout: const Duration(seconds: 20));
        mapVisible = true;
        break;
      } catch (_) {
        // try next label
      }
    }
    expect(mapVisible, isTrue, reason: 'Map page did not render expected title');

    final navigationError = tester.takeException();
    expect(
      navigationError,
      isNull,
      reason: 'Unexpected exception after navigating to map page',
    );
  });
}
