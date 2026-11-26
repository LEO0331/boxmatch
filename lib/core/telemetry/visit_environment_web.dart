// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;
import 'dart:js_interop';

import 'visit_environment.dart';

@JS('navigator')
external _PrivacyProperties get _navigator;

@JS('window')
external _PrivacyProperties get _window;

extension type _PrivacyProperties(JSObject _) implements JSObject {
  external JSAny? get globalPrivacyControl;
  external JSAny? get doNotTrack;
  external JSAny? get msDoNotTrack;
}

VisitEnvironment readVisitEnvironment() {
  bool optedOut = false;
  try {
    optedOut = _navigator.globalPrivacyControl?.dartify() == true;
    for (final target in [_navigator, _window]) {
      for (final property in [target.doNotTrack, target.msDoNotTrack]) {
        final value = property?.dartify();
        if (value == 1 || value == '1' || value == 'yes') optedOut = true;
      }
    }
  } catch (_) {
    // If privacy preferences cannot be inspected, avoid sending a visit.
    optedOut = true;
  }
  return VisitEnvironment(
    uri: Uri.base,
    referrer: html.document.referrer,
    privacyOptOut: optedOut,
  );
}
