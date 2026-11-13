class TicketMessage {
  final String id;
  final String ticketId;
  final String senderType;
  final String? senderId;
  final String message;
  final DateTime createdAt;
  final bool isInternalNote;
  final Map<String, dynamic>? metadata;

  TicketMessage({
    required this.id,
    required this.ticketId,
    required this.senderType,
    this.senderId,
    required this.message,
    required this.createdAt,
    required this.isInternalNote,
    this.metadata,
  });

  bool get isCustomer => senderType == 'customer';
  bool get isDeveloper => senderType == 'developer' || senderType == 'admin';
  bool get isSystem => senderType == 'system';

  factory TicketMessage.fromJson(Map<String, dynamic> json) {
    final meta = json['metadata'] as Map<String, dynamic>?;
    final isNote = json['is_internal_note'] == true ||
        json['isInternalNote'] == true ||
        (meta != null && meta['is_internal_note'] == true);

    DateTime parsedDate;
    try {
      parsedDate = json['created_at'] != null
          ? DateTime.parse(json['created_at'].toString())
          : DateTime.now();
    } catch (_) {
      parsedDate = DateTime.now();
    }

    return TicketMessage(
      id: json['id']?.toString() ?? '',
      ticketId: json['ticket_id']?.toString() ?? '',
      senderType: json['sender_type']?.toString() ?? 'customer',
      senderId: json['sender_id']?.toString(),
      message: json['message']?.toString() ?? json['body']?.toString() ?? '',
      createdAt: parsedDate,
      isInternalNote: isNote,
      metadata: meta,
    );
  }
}

