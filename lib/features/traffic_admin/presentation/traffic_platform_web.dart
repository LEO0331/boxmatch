// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;
import 'dart:js_interop';

import 'traffic_platform_stub.dart' as fallback;

@JS('Intl.DisplayNames')
extension type _RegionNames._(JSObject _) implements JSObject {
  external factory _RegionNames(JSArray<JSString> locales, JSObject options);
  external JSString? of(JSString code);
}

final Map<bool, _RegionNames> _names = {};

String countryName(String code, bool isZhTw) {
  try {
    final names = _names.putIfAbsent(
      isZhTw,
      () => _RegionNames(
        [(isZhTw ? 'zh-TW' : 'en').toJS].toJS,
        {'type': 'region'}.jsify()! as JSObject,
      ),
    );
    return names.of(code.toJS)?.toDart ?? fallback.countryName(code, isZhTw);
  } catch (_) {
    return fallback.countryName(code, isZhTw);
  }
}

bool downloadCsv(String filename, String content) {
  final blob = html.Blob([content], 'text/csv;charset=utf-8');
  final url = html.Url.createObjectUrlFromBlob(blob);
  try {
    final anchor = html.AnchorElement(href: url)..download = filename;
    anchor.click();
    return true;
  } finally {
    html.Url.revokeObjectUrl(url);
  }
}
