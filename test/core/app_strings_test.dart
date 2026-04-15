import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/core/i18n/app_strings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_helpers.dart';

void main() {
  testWidgets('app strings returns english labels', (tester) async {
    final dependencies = await buildTestDependencies(language: 'en');

    late AppStrings strings;
    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              strings = AppStrings.of(context);
              return Text(strings.navListings);
            },
          ),
        ),
      ),
    );

    expect(find.text('Listings'), findsOneWidget);
    expect(strings.statusLabel(AppStatusLabel.completed), 'Completed');
    expect(strings.mapSource('OSM'), contains('OSM'));
    expect(strings.frequentEnterprise, 'Frequent enterprise');
    expect(strings.privacyFaqTitle, 'Privacy & FAQ');
    expect(strings.privacyNotice, contains('Boxmatch'));
    expect(strings.faqNotice, contains('Report safety concern'));
    expect(strings.reportRiskSelectReasonTitle, 'Select a reason');
    expect(strings.riskReasonSuspiciousBehavior, contains('Suspicious'));
    expect(strings.highImpactEnterprise, 'High-impact donor');
    expect(strings.flexiblePickupEnterprise, contains('Flexible'));
    expect(strings.stableShelfLifeEnterprise, contains('Stable'));
    expect(strings.appTitle, isNotEmpty);
    expect(strings.navMap, 'Map');
    expect(strings.navPost, 'Post');
    expect(strings.listingsTitle, isNotEmpty);
    expect(strings.refresh, 'Refresh');
    expect(strings.privateDonor, isNotEmpty);
    expect(strings.noActiveListings, contains('No active listings'));
    expect(strings.localDemoModeNotice, contains('local demo mode'));
    expect(strings.platformDisclaimer, contains('matching service'));
    expect(strings.mapTitle, 'Venue Map');
    expect(strings.activeCount(3), '3 active');
    expect(strings.listingDetailTitle, isNotEmpty);
    expect(strings.myReservationsTitle, isNotEmpty);
    expect(strings.myReservationsCta, isNotEmpty);
    expect(strings.noMyReservations, isNotEmpty);
    expect(strings.cancelReservation, isNotEmpty);
    expect(strings.reservationCancelled, isNotEmpty);
    expect(strings.listingNotFound, isNotEmpty);
    expect(strings.reserveOneItem, isNotEmpty);
    expect(strings.beforeReserving, isNotEmpty);
    expect(strings.reserveDisclaimer, isNotEmpty);
    expect(strings.publicPickupOnlyNotice, isNotEmpty);
    expect(strings.reserveDisclaimerAccept, isNotEmpty);
    expect(strings.cancel, 'Cancel');
    expect(strings.reserve, 'Reserve');
    expect(strings.enterprisePostTitle, isNotEmpty);
    expect(strings.enterpriseEditTitle, isNotEmpty);
    expect(strings.reservationSection, isNotEmpty);
    expect(strings.noReservationsYet, isNotEmpty);
    expect(strings.reservationConfirmed, isNotEmpty);
    expect(strings.reservationNotFound, isNotEmpty);
    expect(strings.offlineIdentityMode, isNotEmpty);
    expect(strings.reportSafetyConcern, isNotEmpty);
    expect(strings.riskReasonPrivateLocation, isNotEmpty);
    expect(strings.riskReasonNoShow, isNotEmpty);
    expect(strings.riskReasonUnsafeCondition, isNotEmpty);
    expect(strings.riskReasonOther, isNotEmpty);
    expect(strings.abuseReported, isNotEmpty);
    expect(strings.verifiedEnterprise, isNotEmpty);
    expect(strings.trustedQualityEnterprise, isNotEmpty);
    expect(strings.pendingConfirm, isNotEmpty);
    expect(strings.confirmedFilter, isNotEmpty);
    expect(strings.showPickupCodeHelp, isNotEmpty);
    expect(strings.retry, isNotEmpty);
    expect(strings.genericLoadErrorTitle, isNotEmpty);
    expect(strings.genericLoadErrorBody, isNotEmpty);
    expect(strings.statusLabel(AppStatusLabel.active), 'Active');
    expect(strings.statusLabel(AppStatusLabel.reserved), 'Reserved');
    expect(strings.statusLabel(AppStatusLabel.expired), 'Expired');
    expect(strings.statusLabel(AppStatusLabel.cancelled), 'Cancelled');
    expect(strings.enterpriseBadgeLabel('verified'), strings.verifiedEnterprise);
    expect(
      strings.enterpriseBadgeLabel('quality_trusted'),
      strings.trustedQualityEnterprise,
    );
    expect(
      strings.enterpriseBadgeLabel('high_impact'),
      strings.highImpactEnterprise,
    );
    expect(
      strings.enterpriseBadgeLabel('flexible_pickup'),
      strings.flexiblePickupEnterprise,
    );
    expect(
      strings.enterpriseBadgeLabel('stable_shelf_life'),
      strings.stableShelfLifeEnterprise,
    );
    expect(strings.enterpriseBadgeLabel('unknown_badge'), isNull);
  });

  testWidgets('app strings returns zh-TW labels', (tester) async {
    final dependencies = await buildTestDependencies(language: 'zh-TW');

    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              final strings = AppStrings.of(context);
              return Column(
                children: [
                  Text(strings.navMap),
                  Text(strings.frequentEnterprise),
                  Text(strings.privacyFaqTitle),
                  Text(strings.reportRiskSelectReasonTitle),
                  Text(strings.highImpactEnterprise),
                ],
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('地圖'), findsOneWidget);
    expect(find.text('常態捐贈企業'), findsOneWidget);
    expect(find.text('隱私與常見問題'), findsOneWidget);
    expect(find.text('請選擇回報原因'), findsOneWidget);
    expect(find.text('高量捐贈企業'), findsOneWidget);
    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              final strings = AppStrings.of(context);
              return Text(strings.statusLabel(AppStatusLabel.cancelled));
            },
          ),
        ),
      ),
    );
    expect(find.text('已取消'), findsOneWidget);
  });
}
