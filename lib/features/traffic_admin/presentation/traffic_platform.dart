import 'traffic_platform_stub.dart'
    if (dart.library.html) 'traffic_platform_web.dart'
    as platform;

String countryName(String code, bool isZhTw) =>
    platform.countryName(code, isZhTw);

bool downloadCsv(String filename, String content) =>
    platform.downloadCsv(filename, content);
