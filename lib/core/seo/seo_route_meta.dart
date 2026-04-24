class SeoRouteMeta {
  const SeoRouteMeta({
    required this.title,
    required this.description,
    required this.path,
  });

  final String title;
  final String description;
  final String path;
}

SeoRouteMeta resolveSeoRouteMeta({
  required String path,
  required bool isZhTw,
}) {
  if (path == '/map') {
    return SeoRouteMeta(
      title: isZhTw ? '場館地圖 | Boxmatch' : 'Venue Map | Boxmatch',
      description: isZhTw
          ? '查看展場據點與可取餐地點，快速找到附近可媒合的剩食。'
          : 'Browse exhibition venues and pickup points to find nearby surplus food.',
      path: '/map',
    );
  }
  if (path == '/enterprise/new') {
    return SeoRouteMeta(
      title: isZhTw ? '企業發佈 | Boxmatch' : 'Post Surplus Listing | Boxmatch',
      description: isZhTw
          ? '企業快速發佈展場剩食：便當、飲料、取餐時間與地點。'
          : 'Enterprise posting flow for exhibition surplus meals and drinks.',
      path: '/enterprise/new',
    );
  }
  if (path == '/my-reservations') {
    return SeoRouteMeta(
      title: isZhTw ? '我的預約 | Boxmatch' : 'My Reservations | Boxmatch',
      description: isZhTw
          ? '查看預約狀態、取餐碼與取消操作。'
          : 'Track reservation status, pickup code, and cancellation actions.',
      path: '/my-reservations',
    );
  }
  if (path.startsWith('/listing/')) {
    return SeoRouteMeta(
      title: isZhTw ? '剩食詳情 | Boxmatch' : 'Listing Details | Boxmatch',
      description: isZhTw
          ? '查看剩食內容、剩餘數量與取餐時段。'
          : 'View listing details, remaining quantity, and pickup window.',
      path: path,
    );
  }
  if (path.startsWith('/enterprise/edit/')) {
    return SeoRouteMeta(
      title: isZhTw ? '企業編輯 | Boxmatch' : 'Enterprise Edit | Boxmatch',
      description: isZhTw
          ? '透過安全連結管理剩食發佈與取餐確認。'
          : 'Manage listing updates and pickup confirmations via secure link.',
      path: path,
    );
  }

  return SeoRouteMeta(
    title: isZhTw
        ? 'Boxmatch｜展場剩食媒合平台'
        : 'Boxmatch | Exhibition Surplus Food Matching',
    description: isZhTw
        ? 'Boxmatch 協助展場減少剩食浪費，媒合便當與飲料給附近有需要的人。'
        : 'Boxmatch helps exhibitions reduce food waste by matching surplus meals and drinks to nearby recipients.',
    path: '/',
  );
}
