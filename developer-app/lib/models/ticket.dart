import 'ticket_message.dart';

class Ticket {
  final String id;
  final String userId;
  final String userEmail;
  final String? userName;
  final String subject;
  final String category;
  final String status;
  final String priority;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int messageCount;
  final List<TicketMessage> messages;

  Ticket({
    required this.id,
    required this.userId,
    required this.userEmail,
    this.userName,
    required this.subject,
    required this.category,
    required this.status,
    required this.priority,
    required this.createdAt,
    required this.updatedAt,
    this.messageCount = 0,
    this.messages = const [],
  });

  bool get isOpen => status == 'open';
  bool get isInProgress => status == 'in_progress';
  bool get isResolved => status == 'resolved';
  bool get isClosed => status == 'closed';

  bool get isUrgent => priority == 'urgent';
  bool get isHighPriority => priority == 'high';

  Ticket copyWith({
    String? status,
    String? priority,
    DateTime? updatedAt,
    List<TicketMessage>? messages,
    int? messageCount,
  }) {
    return Ticket(
      id: id,
      userId: userId,
      userEmail: userEmail,
      userName: userName,
      subject: subject,
      category: category,
      status: status ?? this.status,
      priority: priority ?? this.priority,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      messageCount: messageCount ?? this.messageCount,
      messages: messages ?? this.messages,
    );
  }

  factory Ticket.fromJson(Map<String, dynamic> json, {List<TicketMessage>? messagesList}) {
    DateTime parseDate(dynamic v) {
      if (v == null) return DateTime.now();
      try {
        return DateTime.parse(v.toString());
      } catch (_) {
        return DateTime.now();
      }
    }

    final rawMessages = messagesList ??
        ((json['messages'] as List<dynamic>?)
            ?.map((m) => TicketMessage.fromJson(m as Map<String, dynamic>))
            .toList() ??
            []);

    String normalizeStatus(dynamic raw) {
      final s = raw?.toString().toLowerCase().trim() ?? 'open';
      if (s == 'waiting_customer' || s == 'waiting_on_customer') return 'in_progress';
      if (s == 'in_progress' || s == 'resolved' || s == 'closed' || s == 'open') return s;
      return 'open';
    }

    String normalizePriority(dynamic raw) {
      final p = raw?.toString().toLowerCase().trim() ?? 'normal';
      if (p == 'low' || p == 'normal' || p == 'high' || p == 'urgent') return p;
      if (p == 'medium') return 'normal';
      return 'normal';
    }

    return Ticket(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      // Verified customer email from backend trusted account lookup:
      userEmail: json['user_email']?.toString() ??
          json['customer_email']?.toString() ??
          json['email']?.toString() ??
          'Unknown Email',
      userName: json['user_name']?.toString() ?? json['name']?.toString(),
      subject: json['subject']?.toString() ?? 'No Subject',
      category: json['category']?.toString() ?? 'other',
      status: normalizeStatus(json['status']),
      priority: normalizePriority(json['priority']),
      createdAt: parseDate(json['created_at']),
      updatedAt: parseDate(json['updated_at']),
      messageCount: (json['message_count'] as int?) ?? rawMessages.length,
      messages: rawMessages,
    );
  }
}

