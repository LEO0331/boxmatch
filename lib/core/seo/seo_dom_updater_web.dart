// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;

void applySeoHead({
  required String title,
  required String description,
  required String canonicalUrl,
  required String ogImageUrl,
}) {
  html.document.title = title;
  _upsertMetaByName('description', description);
  _upsertMetaByName('twitter:card', 'summary_large_image');
  _upsertMetaByName('twitter:title', title);
  _upsertMetaByName('twitter:description', description);
  _upsertMetaByName('twitter:image', ogImageUrl);

  _upsertMetaByProperty('og:type', 'website');
  _upsertMetaByProperty('og:title', title);
  _upsertMetaByProperty('og:description', description);
  _upsertMetaByProperty('og:url', canonicalUrl);
  _upsertMetaByProperty('og:image', ogImageUrl);

  _upsertCanonical(canonicalUrl);
}

void _upsertMetaByName(String name, String content) {
  final selector = 'meta[name="$name"]';
  final existing = html.document.head?.querySelector(selector) as html.MetaElement?;
  if (existing != null) {
    existing.content = content;
    return;
  }
  final meta = html.MetaElement()
    ..name = name
    ..content = content;
  html.document.head?.append(meta);
}

void _upsertMetaByProperty(String property, String content) {
  final selector = 'meta[property="$property"]';
  final existing = html.document.head?.querySelector(selector) as html.MetaElement?;
  if (existing != null) {
    existing.content = content;
    return;
  }
  final meta = html.MetaElement()
    ..setAttribute('property', property)
    ..content = content;
  html.document.head?.append(meta);
}

void _upsertCanonical(String url) {
  const selector = 'link[rel="canonical"]';
  final existing = html.document.head?.querySelector(selector) as html.LinkElement?;
  if (existing != null) {
    existing.href = url;
    return;
  }
  final canonical = html.LinkElement()
    ..rel = 'canonical'
    ..href = url;
  html.document.head?.append(canonical);
}
