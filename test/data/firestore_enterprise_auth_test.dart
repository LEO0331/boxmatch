import 'dart:convert';

import 'package:boxmatch/features/surplus/data/firestore_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _UnusedFirestore extends Fake implements FirebaseFirestore {}

void main() {
  test(
    'enterprise creation sends the authenticated principal bearer token',
    () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/enterprise/listings/create');
        expect(request.headers['authorization'], 'Bearer enterprise-id-token');
        return http.Response(
          jsonEncode({'listingId': 'new-listing', 'token': 'edit-capability'}),
          200,
        );
      });
      final repository = FirestoreSurplusRepository(
        _UnusedFirestore(),
        apiBaseUrl: 'https://api.example.com',
        httpClient: client,
        idTokenProvider: () async => 'enterprise-id-token',
      );
      final now = DateTime.now();
      final result = await repository.createListing(
        ListingInput(
          venueId: 'venue',
          pickupPointText: 'Booth A',
          itemType: 'Lunchbox',
          description: 'Surplus meals',
          quantityTotal: 1,
          price: 0,
          currency: 'TWD',
          pickupStartAt: now.add(const Duration(minutes: 30)),
          pickupEndAt: now.add(const Duration(hours: 1)),
          expiresAt: now.add(const Duration(hours: 2)),
          visibility: ListingVisibility.minimal,
          disclaimerAccepted: true,
        ),
      );
      expect(result.listingId, 'new-listing');
      client.close();
    },
  );
}
