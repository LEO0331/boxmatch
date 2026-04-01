import 'package:boxmatch/app/app.dart';
import 'package:boxmatch/app/app_dependencies.dart';
import 'package:boxmatch/core/identity/recipient_identity_service.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeIdentityService implements RecipientIdentityService {
  @override
  Future<String> ensureRecipientUid() async => 'test-user';
}

void main() {
  testWidgets('renders listings home page', (WidgetTester tester) async {
    final repository = InMemorySurplusRepository();
    await repository.ensureSeedData();

    await tester.pumpWidget(
      BoxmatchApp(
        dependencies: AppDependencies(
          repository: repository,
          identityService: _FakeIdentityService(),
          usingFirebase: false,
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Exhibition Surplus Food'), findsOneWidget);
    expect(find.textContaining('No active listings'), findsOneWidget);
  });
}
