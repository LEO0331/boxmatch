import 'package:intl/intl.dart';

final _dateTimeFormat = DateFormat('yyyy/MM/dd HH:mm');

String formatDateTime(DateTime value) =>
    _dateTimeFormat.format(value.toLocal());
