class DashboardStats {
  final int total;
  final int open;
  final int inProgress;
  final int resolved;
  final int closed;

  DashboardStats({
    required this.total,
    required this.open,
    required this.inProgress,
    required this.resolved,
    required this.closed,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    return DashboardStats(
      total: json['total'] as int? ?? 0,
      open: json['open'] as int? ?? 0,
      inProgress: json['in_progress'] as int? ?? 0,
      resolved: json['resolved'] as int? ?? 0,
      closed: json['closed'] as int? ?? 0,
    );
  }

  factory DashboardStats.empty() {
    return DashboardStats(
      total: 0,
      open: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
    );
  }
}

