import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing_input.dart';
import '../../../surplus/domain/listing_visibility.dart';
import '../../../surplus/domain/reservation.dart';
import '../../../surplus/domain/surplus_exceptions.dart';
import '../../../surplus/domain/venue.dart';

class _QuickPostTemplate {
  const _QuickPostTemplate({
    required this.id,
    required this.nameEn,
    required this.nameZh,
    required this.itemType,
    required this.description,
    required this.defaultQuantity,
    required this.pickupDurationMinutes,
    required this.expireAfterMinutes,
  });

  final String id;
  final String nameEn;
  final String nameZh;
  final String itemType;
  final String description;
  final int defaultQuantity;
  final int pickupDurationMinutes;
  final int expireAfterMinutes;
}

const _quickTemplates = <_QuickPostTemplate>[
  _QuickPostTemplate(
    id: 'lunchbox',
    nameEn: 'Lunchbox Batch',
    nameZh: '便當批次',
    itemType: 'Lunchbox',
    description: 'Fresh boxed meal from booth surplus.',
    defaultQuantity: 20,
    pickupDurationMinutes: 90,
    expireAfterMinutes: 120,
  ),
  _QuickPostTemplate(
    id: 'drinks',
    nameEn: 'Bottled Drinks',
    nameZh: '瓶裝飲料',
    itemType: 'Drink',
    description: 'Sealed bottled drinks, room temperature.',
    defaultQuantity: 30,
    pickupDurationMinutes: 120,
    expireAfterMinutes: 180,
  ),
  _QuickPostTemplate(
    id: 'snack',
    nameEn: 'Snack Packs',
    nameZh: '點心包',
    itemType: 'Snack Pack',
    description: 'Unopened snack package from event counter.',
    defaultQuantity: 15,
    pickupDurationMinutes: 90,
    expireAfterMinutes: 150,
  ),
];

class EnterpriseListingPage extends StatefulWidget {
  const EnterpriseListingPage({super.key, this.listingId, this.token});

  final String? listingId;
  final String? token;

  @override
  State<EnterpriseListingPage> createState() => _EnterpriseListingPageState();
}

class _EnterpriseListingPageState extends State<EnterpriseListingPage> {
  final _formKey = GlobalKey<FormState>();
  final _pickupPointController = TextEditingController();
  final _itemTypeController = TextEditingController(text: 'Lunchbox');
  final _descriptionController = TextEditingController();
  final _quantityController = TextEditingController(text: '1');
  final _displayNameController = TextEditingController();
  final Map<String, TextEditingController> _pickupCodeControllers = {};

  String? _selectedVenueId;
  String? _selectedTemplateId;
  DateTime _pickupStartAt = DateTime.now().add(const Duration(minutes: 20));
  DateTime _pickupEndAt = DateTime.now().add(const Duration(hours: 2));
  DateTime _expiresAt = DateTime.now().add(
    const Duration(hours: 2, minutes: 30),
  );
  bool _disclaimerAccepted = false;
  bool _busy = false;
  bool _initialized = false;
  String? _editToken;
  String? _createdEditLink;
  String? _errorMessage;
  bool _tokenRevoked = false;

  bool get _isEditMode => widget.listingId != null;

  @override
  void dispose() {
    _pickupPointController.dispose();
    _itemTypeController.dispose();
    _descriptionController.dispose();
    _quantityController.dispose();
    _displayNameController.dispose();
    for (final controller in _pickupCodeControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initialized) {
      _initialized = true;
      _bootstrap();
    }
  }

  Future<void> _bootstrap() async {
    if (!_isEditMode) {
      return;
    }

    final token = widget.token;
    final listingId = widget.listingId;
    if (listingId == null || token == null || token.isEmpty) {
      setState(() {
        _errorMessage = 'Missing edit token. Please use your secure edit link.';
      });
      return;
    }

    final dependencies = AppScope.of(context);
    late final bool canEdit;
    try {
      canEdit = await dependencies.repository.canEditListing(
        listingId: listingId,
        token: token,
      );
    } on ApiUnavailableException {
      setState(() {
        _errorMessage = 'Cannot reach API';
      });
      return;
    } on SurplusException {
      setState(() {
        _errorMessage = 'Cannot reach API';
      });
      return;
    }

    if (!canEdit) {
      setState(() {
        _errorMessage = 'Invalid token';
      });
      return;
    }

    final listing = await dependencies.repository.watchListing(listingId).first;
    if (listing == null) {
      setState(() {
        _errorMessage = 'Listing no longer exists.';
      });
      return;
    }

    setState(() {
      _editToken = token;
      _selectedVenueId = listing.venueId;
      _pickupPointController.text = listing.pickupPointText;
      _itemTypeController.text = listing.itemType;
      _descriptionController.text = listing.description;
      _quantityController.text = listing.quantityTotal.toString();
      _displayNameController.text = listing.displayNameOptional ?? '';
      _pickupStartAt = listing.pickupStartAt;
      _pickupEndAt = listing.pickupEndAt;
      _expiresAt = listing.expiresAt;
      _disclaimerAccepted = true;
    });
  }

  void _applyTemplate(_QuickPostTemplate template) {
    final now = DateTime.now();
    setState(() {
      _selectedTemplateId = template.id;
      _itemTypeController.text = template.itemType;
      _descriptionController.text = template.description;
      _quantityController.text = template.defaultQuantity.toString();
      _pickupStartAt = now.add(const Duration(minutes: 20));
      _pickupEndAt = _pickupStartAt.add(
        Duration(minutes: template.pickupDurationMinutes),
      );
      _expiresAt = _pickupStartAt.add(
        Duration(minutes: template.expireAfterMinutes),
      );
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final venueId = _selectedVenueId;
    if (venueId == null || venueId.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Please select a venue.')));
      return;
    }

    setState(() {
      _busy = true;
    });

    final dependencies = AppScope.of(context);

    final input = ListingInput(
      venueId: venueId,
      pickupPointText: _pickupPointController.text.trim(),
      itemType: _itemTypeController.text.trim(),
      description: _descriptionController.text.trim(),
      quantityTotal: int.parse(_quantityController.text.trim()),
      price: 0,
      currency: 'TWD',
      pickupStartAt: _pickupStartAt,
      pickupEndAt: _pickupEndAt,
      expiresAt: _expiresAt,
      displayNameOptional: _displayNameController.text.trim().isEmpty
          ? null
          : _displayNameController.text.trim(),
      visibility: ListingVisibility.minimal,
      disclaimerAccepted: _disclaimerAccepted,
    );

    try {
      if (_isEditMode) {
        final token = _editToken;
        if (token == null || token.isEmpty) {
          throw const PermissionDeniedException('Missing edit token.');
        }
        await dependencies.repository.updateListing(
          listingId: widget.listingId!,
          token: token,
          input: input,
        );

        if (!mounted) {
          return;
        }
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Listing updated.')));
      } else {
        final result = await dependencies.repository.createListing(input);
        final link = _buildEditLink(result.listingId, result.editToken);

        setState(() {
          _createdEditLink = link;
        });

        if (!mounted) {
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Listing posted. Save your edit link.')),
        );
      }
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  String _buildEditLink(String listingId, String token) {
    final base = Uri.base;
    final uri = base.replace(
      path: '/enterprise/edit/$listingId',
      queryParameters: {'token': token},
      fragment: null,
    );
    return uri.toString();
  }

  Future<void> _copyEditLink() async {
    final link = _createdEditLink;
    if (link == null || link.isEmpty) {
      return;
    }

    await Clipboard.setData(ClipboardData(text: link));
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Secure edit link copied to clipboard.')),
    );
  }

  Future<bool> _showConfirmDialog({
    required String title,
    required String content,
    required String confirmText,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmText),
          ),
        ],
      ),
    );

    return result ?? false;
  }

  Future<void> _rotateToken() async {
    final listingId = widget.listingId;
    final token = _editToken;
    if (listingId == null || token == null || token.isEmpty) {
      return;
    }

    final allowed = await _showConfirmDialog(
      title: 'Rotate edit token?',
      content:
          'Your old edit link will stop working immediately. Copy and store the new one safely.',
      confirmText: 'Rotate',
    );
    if (!allowed) {
      return;
    }
    if (!mounted) {
      return;
    }

    setState(() {
      _busy = true;
    });

    final dependencies = AppScope.of(context);
    try {
      final nextToken = await dependencies.repository.rotateEditToken(
        listingId: listingId,
        token: token,
      );
      final link = _buildEditLink(listingId, nextToken);
      setState(() {
        _editToken = nextToken;
        _createdEditLink = link;
      });
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<void> _revokeToken() async {
    final listingId = widget.listingId;
    final token = _editToken;
    if (listingId == null || token == null || token.isEmpty) {
      return;
    }

    final allowed = await _showConfirmDialog(
      title: 'Revoke edit token?',
      content:
          'This action cannot be undone. You will lose edit access from this link.',
      confirmText: 'Revoke',
    );
    if (!allowed) {
      return;
    }
    if (!mounted) {
      return;
    }

    setState(() {
      _busy = true;
    });

    final dependencies = AppScope.of(context);
    try {
      await dependencies.repository.revokeEditToken(
        listingId: listingId,
        token: token,
      );
      setState(() {
        _tokenRevoked = true;
        _editToken = null;
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Edit token revoked.')));
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<void> _confirmPickup(Reservation reservation) async {
    final listingId = widget.listingId;
    final token = _editToken;
    if (listingId == null || token == null || token.isEmpty) {
      return;
    }

    final codeController = _pickupCodeControllers.putIfAbsent(
      reservation.id,
      TextEditingController.new,
    );
    final inputCode = codeController.text.trim();

    if (inputCode.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Enter pickup code first.')));
      return;
    }

    final dependencies = AppScope.of(context);
    try {
      await dependencies.repository.confirmPickup(
        listingId: listingId,
        reservationId: reservation.id,
        token: token,
        pickupCode: inputCode,
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Pickup confirmed.')));
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _pickDateTime({
    required DateTime initial,
    required ValueChanged<DateTime> onPicked,
  }) async {
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );

    if (date == null || !mounted) {
      return;
    }

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );

    if (time == null) {
      return;
    }

    onPicked(DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  @override
  Widget build(BuildContext context) {
    final repository = AppScope.of(context).repository;
    final s = AppStrings.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _isEditMode ? s.enterpriseEditTitle : s.enterprisePostTitle,
        ),
        actions: const [LanguageMenuButton()],
      ),
      body: StreamBuilder<List<Venue>>(
        stream: repository.watchVenues(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorView(
              title: s.genericLoadErrorTitle,
              message: s.genericLoadErrorBody,
              retryLabel: s.retry,
              onRetry: () => setState(() {}),
            );
          }

          final venues = snapshot.data ?? const <Venue>[];

          if (_selectedVenueId == null && venues.isNotEmpty) {
            _selectedVenueId = venues.first.id;
          }

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_errorMessage != null)
                Card(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_errorMessage!),
                  ),
                ),
              if (_createdEditLink != null) _buildSecureLinkCard(context),
              if (!_isEditMode) _buildTemplateCard(context),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue: _selectedVenueId,
                          items: venues
                              .map(
                                (venue) => DropdownMenuItem(
                                  value: venue.id,
                                  child: Text(venue.name),
                                ),
                              )
                              .toList(),
                          onChanged: _busy
                              ? null
                              : (value) {
                                  setState(() {
                                    _selectedVenueId = value;
                                  });
                                },
                          decoration: const InputDecoration(labelText: 'Venue'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _pickupPointController,
                          decoration: const InputDecoration(
                            labelText: 'Pickup point (booth / gate)',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Pickup point is required.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _itemTypeController,
                          decoration: const InputDecoration(
                            labelText: 'Item type',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Item type is required.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _descriptionController,
                          maxLines: 3,
                          decoration: const InputDecoration(
                            labelText: 'Simple description',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Description is required.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _quantityController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Quantity',
                          ),
                          validator: (value) {
                            final parsed = int.tryParse(value ?? '');
                            if (parsed == null || parsed <= 0) {
                              return 'Enter a quantity of at least 1.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _displayNameController,
                          decoration: const InputDecoration(
                            labelText: 'Display name (optional)',
                          ),
                        ),
                        const SizedBox(height: 12),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Pickup start'),
                          subtitle: Text(formatDateTime(_pickupStartAt)),
                          trailing: IconButton(
                            onPressed: _busy
                                ? null
                                : () => _pickDateTime(
                                    initial: _pickupStartAt,
                                    onPicked: (value) {
                                      setState(() {
                                        _pickupStartAt = value;
                                      });
                                    },
                                  ),
                            icon: const Icon(Icons.schedule),
                          ),
                        ),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Pickup end'),
                          subtitle: Text(formatDateTime(_pickupEndAt)),
                          trailing: IconButton(
                            onPressed: _busy
                                ? null
                                : () => _pickDateTime(
                                    initial: _pickupEndAt,
                                    onPicked: (value) {
                                      setState(() {
                                        _pickupEndAt = value;
                                      });
                                    },
                                  ),
                            icon: const Icon(Icons.schedule_send_outlined),
                          ),
                        ),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Expires at'),
                          subtitle: Text(formatDateTime(_expiresAt)),
                          trailing: IconButton(
                            onPressed: _busy
                                ? null
                                : () => _pickDateTime(
                                    initial: _expiresAt,
                                    onPicked: (value) {
                                      setState(() {
                                        _expiresAt = value;
                                      });
                                    },
                                  ),
                            icon: const Icon(Icons.hourglass_bottom_outlined),
                          ),
                        ),
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _disclaimerAccepted,
                          onChanged: _busy
                              ? null
                              : (value) {
                                  setState(() {
                                    _disclaimerAccepted = value ?? false;
                                  });
                                },
                          title: Text(s.reserveDisclaimer),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _busy || _tokenRevoked ? null : _submit,
                          icon: _busy
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.save_outlined),
                          label: Text(
                            _isEditMode ? 'Update listing' : 'Post listing',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (_isEditMode && _errorMessage == null) ...[
                const SizedBox(height: 12),
                _buildTokenControlsCard(),
                const SizedBox(height: 12),
                if ((_editToken ?? '').isNotEmpty)
                  _ReservationAdminSection(
                    listingId: widget.listingId!,
                    token: _editToken!,
                    onConfirmPickup: _confirmPickup,
                    pickupCodeControllers: _pickupCodeControllers,
                  ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _buildTemplateCard(BuildContext context) {
    final isZh = AppScope.of(context).localeController.isZhTw;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isZh ? '快速模板（加速發佈）' : 'Quick templates (faster post)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _quickTemplates
                  .map(
                    (template) => ChoiceChip(
                      selected: _selectedTemplateId == template.id,
                      onSelected: (_) => _applyTemplate(template),
                      label: Text(isZh ? template.nameZh : template.nameEn),
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSecureLinkCard(BuildContext context) {
    final isZh = AppScope.of(context).localeController.isZhTw;

    return Card(
      color: Theme.of(context).colorScheme.surfaceContainerHigh,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(isZh ? '請妥善保存此編輯連結：' : 'Save this edit link securely:'),
            const SizedBox(height: 8),
            SelectableText(_createdEditLink!),
            const SizedBox(height: 8),
            Text(
              isZh
                  ? '安全提醒：此連結即擁有編輯權限，請勿公開分享。'
                  : 'Security note: anyone with this link can edit your listing.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _copyEditLink,
              icon: const Icon(Icons.copy_all_outlined),
              label: Text(isZh ? '複製連結' : 'Copy link'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTokenControlsCard() {
    final isZh = AppScope.of(context).localeController.isZhTw;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(isZh ? 'Token 安全控管' : 'Token controls'),
            const SizedBox(height: 6),
            Text(
              isZh
                  ? '建議活動結束後立即 Rotate 或 Revoke，降低外流風險。'
                  : 'Rotate or revoke after event day to reduce token leakage risk.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _busy || _tokenRevoked ? null : _rotateToken,
                  icon: const Icon(Icons.key_outlined),
                  label: Text(isZh ? 'Rotate token' : 'Rotate token'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy || _tokenRevoked ? null : _revokeToken,
                  icon: const Icon(Icons.block_outlined),
                  label: Text(isZh ? 'Revoke token' : 'Revoke token'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ReservationAdminSection extends StatelessWidget {
  const _ReservationAdminSection({
    required this.listingId,
    required this.token,
    required this.onConfirmPickup,
    required this.pickupCodeControllers,
  });

  final String listingId;
  final String token;
  final Future<void> Function(Reservation reservation) onConfirmPickup;
  final Map<String, TextEditingController> pickupCodeControllers;

  @override
  Widget build(BuildContext context) {
    final repository = AppScope.of(context).repository;
    final s = AppStrings.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s.reservationSection),
            const SizedBox(height: 8),
            StreamBuilder<List<Reservation>>(
              stream: repository.watchReservationsForListing(
                listingId: listingId,
                token: token,
              ),
              builder: (context, snapshot) {
                final reservations = snapshot.data ?? const <Reservation>[];
                if (snapshot.connectionState == ConnectionState.waiting &&
                    reservations.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Text('Unable to load reservations: ${snapshot.error}');
                }
                if (reservations.isEmpty) {
                  return Text(s.noReservationsYet);
                }

                return Column(
                  children: reservations.map((reservation) {
                    final codeController = pickupCodeControllers.putIfAbsent(
                      reservation.id,
                      TextEditingController.new,
                    );
                    return Card(
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Reservation ${reservation.id.substring(0, 6)}',
                            ),
                            Text(
                              'Status: ${s.statusLabel(_toLabel(reservation.status))}',
                            ),
                            Text('Qty: ${reservation.qty}'),
                            const SizedBox(height: 8),
                            TextField(
                              controller: codeController,
                              decoration: const InputDecoration(
                                labelText: 'Enter 4-digit pickup code',
                              ),
                            ),
                            const SizedBox(height: 8),
                            FilledButton(
                              onPressed:
                                  reservation.status ==
                                      ReservationStatus.reserved
                                  ? () => onConfirmPickup(reservation)
                                  : null,
                              child: const Text('Confirm pickup'),
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  AppStatusLabel _toLabel(ReservationStatus status) {
    switch (status) {
      case ReservationStatus.reserved:
        return AppStatusLabel.reserved;
      case ReservationStatus.completed:
        return AppStatusLabel.completed;
      case ReservationStatus.expired:
        return AppStatusLabel.expired;
      case ReservationStatus.cancelled:
        return AppStatusLabel.cancelled;
    }
  }
}
