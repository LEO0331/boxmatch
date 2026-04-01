import 'package:flutter/material.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/reservation.dart';

class ReservationConfirmationPage extends StatelessWidget {
  const ReservationConfirmationPage({
    required this.listingId,
    required this.reservationId,
    super.key,
  });

  final String listingId;
  final String reservationId;

  @override
  Widget build(BuildContext context) {
    final repository = AppScope.of(context).repository;

    return Scaffold(
      appBar: AppBar(title: const Text('Reservation confirmed')),
      body: StreamBuilder<Reservation?>(
        stream: repository.watchReservation(reservationId),
        builder: (context, reservationSnapshot) {
          final reservation = reservationSnapshot.data;
          if (reservation == null) {
            if (reservationSnapshot.connectionState ==
                ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            return const Center(child: Text('Reservation not found.'));
          }

          return StreamBuilder<Listing?>(
            stream: repository.watchListing(listingId),
            builder: (context, listingSnapshot) {
              final listing = listingSnapshot.data;
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          Text(
                            reservation.pickupCode,
                            style: Theme.of(context).textTheme.displayMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Show this 4-digit code to the enterprise at pickup.',
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Reservation status: ${reservation.status.name}',
                          ),
                          const SizedBox(height: 8),
                          if (listing != null) ...[
                            Text('Item: ${listing.itemType}'),
                            Text('Pickup point: ${listing.pickupPointText}'),
                            Text(
                              'Pickup window: ${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}',
                            ),
                          ],
                          Text(
                            'Reservation expires at: ${formatDateTime(reservation.expiresAt)}',
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}
