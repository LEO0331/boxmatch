import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

String trafficNumber(num? value, bool isZhTw) => value == null
    ? '—'
    : NumberFormat.decimalPattern(isZhTw ? 'zh_TW' : 'en').format(value);

String trafficPercent(num? value) =>
    value == null ? '—' : '${value.toStringAsFixed(1)}%';

class TrafficSection extends StatelessWidget {
  const TrafficSection({
    required this.title,
    required this.child,
    this.note,
    super.key,
  });
  final String title;
  final String? note;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        if (note != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(note!, style: Theme.of(context).textTheme.bodySmall),
          ),
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}

class TrafficPanel extends StatelessWidget {
  const TrafficPanel({required this.title, required this.child, super.key});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: const Color(0xffd9e1db)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 14),
        child,
      ],
    ),
  );
}

class TrafficColumns extends StatelessWidget {
  const TrafficColumns({required this.children, super.key});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 980
          ? 3
          : constraints.maxWidth >= 650
          ? 2
          : 1;
      final width = (constraints.maxWidth - 16 * (columns - 1)) / columns;
      return Wrap(
        spacing: 16,
        runSpacing: 16,
        children: [
          for (final child in children) SizedBox(width: width, child: child),
        ],
      );
    },
  );
}

class TrafficDistribution extends StatefulWidget {
  const TrafficDistribution({
    required this.title,
    required this.values,
    required this.isZhTw,
    required this.label,
    super.key,
  });
  final String title;
  final Map<String, dynamic> values;
  final bool isZhTw;
  final String Function(String) label;

  @override
  State<TrafficDistribution> createState() => _TrafficDistributionState();
}

class _TrafficDistributionState extends State<TrafficDistribution> {
  bool _alphabetic = false;
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final entries = widget.values.entries
        .where((entry) => entry.value is num)
        .toList();
    entries.sort((a, b) {
      final comparison = _alphabetic
          ? widget.label(a.key).compareTo(widget.label(b.key))
          : (b.value as num).compareTo(a.value as num);
      return comparison == 0 ? a.key.compareTo(b.key) : comparison;
    });
    final visible = _expanded ? entries : entries.take(8);
    final maximum = entries.fold<num>(
      0,
      (current, entry) => math.max(current, entry.value as num),
    );
    final total = entries.fold<num>(
      0,
      (current, entry) => current + (entry.value as num),
    );
    return TrafficPanel(
      title: widget.title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entries.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => setState(() => _alphabetic = !_alphabetic),
                child: Text(
                  _alphabetic
                      ? (widget.isZhTw ? '依數量排序' : 'Sort by count')
                      : (widget.isZhTw ? '依名稱排序' : 'Sort by name'),
                ),
              ),
            ),
          if (entries.isEmpty)
            Text(widget.isZhTw ? '無可用觀測資料' : 'No observations available'),
          for (final entry in visible)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Semantics(
                label:
                    '${widget.label(entry.key)}: ${trafficNumber(entry.value as num, widget.isZhTw)}',
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: Text(widget.label(entry.key))),
                        const SizedBox(width: 8),
                        Text(
                          trafficNumber(entry.value as num, widget.isZhTw),
                          style: const TextStyle(
                            fontFeatures: [FontFeature.tabularFigures()],
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 47,
                          child: Text(
                            total == 0
                                ? '—'
                                : '${(100 * (entry.value as num) / total).toStringAsFixed(1)}%',
                            textAlign: TextAlign.right,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    LinearProgressIndicator(
                      value: maximum == 0 ? 0 : (entry.value as num) / maximum,
                      minHeight: 5,
                      backgroundColor: const Color(0xffedf1ed),
                    ),
                  ],
                ),
              ),
            ),
          if (entries.length > 8)
            TextButton(
              onPressed: () => setState(() => _expanded = !_expanded),
              child: Text(
                _expanded
                    ? (widget.isZhTw ? '收合' : 'Show less')
                    : (widget.isZhTw
                          ? '顯示全部 ${entries.length} 項'
                          : 'Show all ${entries.length} categories'),
              ),
            ),
        ],
      ),
    );
  }
}

class TrafficTrend extends StatelessWidget {
  const TrafficTrend({
    required this.title,
    required this.dates,
    required this.series,
    required this.isZhTw,
    super.key,
  });
  final String title;
  final List<String> dates;
  final List<TrafficSeries> series;
  final bool isZhTw;

  @override
  Widget build(BuildContext context) => TrafficPanel(
    title: title,
    child: Column(
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 6,
          children: [
            for (final item in series)
              Text.rich(
                TextSpan(
                  children: [
                    WidgetSpan(
                      alignment: PlaceholderAlignment.middle,
                      child: Container(width: 12, height: 4, color: item.color),
                    ),
                    TextSpan(text: ' ${item.label}'),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        if (series.any((item) => item.values.any((value) => value != null)))
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '${isZhTw ? '數量範圍' : 'Count scale'}: 0–${trafficNumber(series.expand((item) => item.values).whereType<int>().fold<int>(0, math.max), isZhTw)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        const SizedBox(height: 4),
        Semantics(
          label:
              '$title. ${isZhTw ? '缺少觀測的日期以斷線呈現，並非零流量。' : 'Gaps are unavailable days, not zero traffic.'}',
          child: SizedBox(
            height: 160,
            width: double.infinity,
            child: CustomPaint(painter: _TrendPainter(series)),
          ),
        ),
        const SizedBox(height: 6),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: Text(dates.isEmpty ? '—' : dates.first)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                dates.isEmpty ? '—' : dates.last,
                textAlign: TextAlign.right,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          isZhTw
              ? 'UTC 每日彙總；斷線表示資料不可用'
              : 'Daily UTC aggregates; gaps indicate unavailable observations',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    ),
  );
}

class TrafficSeries {
  const TrafficSeries(this.label, this.color, this.values);
  final String label;
  final Color color;
  final List<int?> values;
}

class _TrendPainter extends CustomPainter {
  _TrendPainter(this.series);
  final List<TrafficSeries> series;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xffe3e9e3)
      ..strokeWidth = 1;
    for (var line = 0; line < 4; line++) {
      final y = size.height * line / 3;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
    final maximum = series
        .expand((item) => item.values)
        .whereType<int>()
        .fold<int>(1, math.max);
    for (final item in series) {
      final stroke = Paint()
        ..color = item.color
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke;
      Offset? previous;
      for (var index = 0; index < item.values.length; index++) {
        final value = item.values[index];
        if (value == null) {
          previous = null;
          continue;
        }
        final point = Offset(
          item.values.length == 1
              ? size.width / 2
              : index * size.width / (item.values.length - 1),
          size.height - value / maximum * (size.height - 6) - 3,
        );
        if (previous != null) canvas.drawLine(previous, point, stroke);
        canvas.drawCircle(point, 2.5, Paint()..color = item.color);
        previous = point;
      }
    }
  }

  @override
  bool shouldRepaint(_TrendPainter oldDelegate) => oldDelegate.series != series;
}
