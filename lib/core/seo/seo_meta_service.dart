import 'seo_route_meta.dart';
import 'seo_dom_updater_stub.dart'
    if (dart.library.html) 'seo_dom_updater_web.dart' as dom_updater;

class SeoMetaService {
  static const String _fallbackOgImage =
      'https://leo0331.github.io/boxmatch/social/boxmatch-og-card.png';

  static void updateForPath({
    required String path,
    required bool isZhTw,
  }) {
    final meta = resolveSeoRouteMeta(path: path, isZhTw: isZhTw);
    final canonical = _canonicalForPath(meta.path);
    dom_updater.applySeoHead(
      title: meta.title,
      description: meta.description,
      canonicalUrl: canonical,
      ogImageUrl: _fallbackOgImage,
    );
  }

  static String _canonicalForPath(String path) {
    final root = Uri.base.replace(fragment: '', query: '').toString();
    if (path == '/' || path.isEmpty) {
      return root;
    }
    final normalized = path.startsWith('/') ? path : '/$path';
    return '$root#$normalized';
  }
}
