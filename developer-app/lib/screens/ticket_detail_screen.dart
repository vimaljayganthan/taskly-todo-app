import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../constants.dart';
import '../models/ticket.dart';
import '../models/ticket_message.dart';
import '../services/api_service.dart';

class TicketDetailScreen extends StatefulWidget {
  final String ticketId;

  const TicketDetailScreen({super.key, required this.ticketId});

  @override
  State<TicketDetailScreen> createState() => _TicketDetailScreenState();
}

class _TicketDetailScreenState extends State<TicketDetailScreen> {
  Ticket? _ticket;
  bool _isLoading = true;
  bool _isSending = false;
  String? _errorMessage;

  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  // Composer mode: 0 = Public Reply, 1 = Internal Note
  int _composerMode = 0;

  @override
  void initState() {
    super.initState();
    _loadTicket();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadTicket() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final ticket = await ApiService().getTicketDetail(widget.ticketId);
      if (!mounted) return;
      setState(() {
        _ticket = ticket;
        _isLoading = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _handleStatusChange(String newStatus) async {
    if (_ticket == null || _ticket!.status == newStatus) return;

    final oldTicket = _ticket!;
    setState(() {
      _ticket = _ticket!.copyWith(status: newStatus);
    });

    try {
      final updated = await ApiService().updateTicketStatus(widget.ticketId, newStatus);
      if (!mounted) return;
      setState(() {
        _ticket = _ticket!.copyWith(status: updated.status, updatedAt: updated.updatedAt);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Status updated to ${newStatus.toUpperCase()}')),
      );
      await _loadTicket();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ticket = oldTicket;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to update status: $e'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _handlePriorityChange(String newPriority) async {
    if (_ticket == null || _ticket!.priority == newPriority) return;

    final oldTicket = _ticket!;
    setState(() {
      _ticket = _ticket!.copyWith(priority: newPriority);
    });

    try {
      final updated = await ApiService().updateTicketPriority(widget.ticketId, newPriority);
      if (!mounted) return;
      setState(() {
        _ticket = _ticket!.copyWith(priority: updated.priority, updatedAt: updated.updatedAt);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Priority updated to ${newPriority.toUpperCase()}')),
      );
      await _loadTicket();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ticket = oldTicket;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to update priority: $e'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _handleSubmitMessage({String? nextStatus}) async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    setState(() {
      _isSending = true;
    });

    try {
      if (_composerMode == 1) {
        // Internal Note (strictly isolated from customer view)
        await ApiService().addInternalNote(widget.ticketId, text);
      } else {
        // Public Reply
        await ApiService().sendReply(widget.ticketId, text, nextStatus: nextStatus);
      }

      _messageController.clear();

      // Refresh ticket details to retrieve updated message stream and status
      await _loadTicket();

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_composerMode == 1 ? 'Internal note added' : 'Reply sent to customer'),
          backgroundColor: _composerMode == 1 ? Colors.amber.shade900 : AppConstants.primaryColor,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send: $e'), backgroundColor: Colors.red),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSending = false;
        });
      }
    }
  }

  void _copyToClipboard(String text, String label) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copied to clipboard')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        Navigator.pop(context, true); // Signal dashboard to refresh
      },
      child: Scaffold(
        backgroundColor: AppConstants.backgroundColor,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: AppConstants.textColor),
            onPressed: () => Navigator.pop(context, true),
          ),
          title: Text(
            _ticket != null ? 'Ticket #${_ticket!.id.substring(0, _ticket!.id.length.clamp(0, 8))}' : 'Ticket Details',
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppConstants.textColor,
            ),
          ),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1.0),
            child: Container(color: AppConstants.borderColor, height: 1.0),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh, color: AppConstants.textColor),
              onPressed: _loadTicket,
            ),
          ],
        ),
        body: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _errorMessage != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
                    ),
                  )
                : _ticket == null
                    ? const Center(child: Text('Ticket not found'))
                    : Column(
                        children: [
                          // Header Information Panel
                          _buildTicketHeader(),
                          const Divider(height: 1, color: AppConstants.borderColor),

                          // Conversation Stream
                          Expanded(
                            child: ListView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                              itemCount: _ticket!.messages.length,
                              itemBuilder: (context, index) {
                                final message = _ticket!.messages[index];
                                return _buildMessageBubble(message);
                              },
                            ),
                          ),

                          // Reply & Note Composer
                          _buildComposer(),
                        ],
                      ),
      ),
    );
  }

  Widget _buildTicketHeader() {
    final ticket = _ticket!;
    final createdStr = DateFormat('MMM d, yyyy h:mm a').format(ticket.createdAt);

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    final currentStatus = validStatuses.contains(ticket.status) ? ticket.status : 'open';

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    final currentPriority = validPriorities.contains(ticket.priority) ? ticket.priority : 'normal';

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Subject
          Text(
            ticket.subject,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppConstants.textColor,
            ),
          ),
          const SizedBox(height: 8),

          // Customer Verified Info Box
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppConstants.borderColor),
            ),
            child: Row(
              children: [
                const Icon(Icons.verified_user, size: 18, color: AppConstants.primaryColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Verified Customer Email:',
                        style: TextStyle(fontSize: 10, color: AppConstants.textMuted, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        ticket.userEmail,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppConstants.textColor,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy, size: 16, color: AppConstants.primaryColor),
                  tooltip: 'Copy customer email',
                  onPressed: () => _copyToClipboard(ticket.userEmail, 'Customer email'),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Status & Priority Selectors
          Row(
            children: [
              // Status Dropdown
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Status', style: TextStyle(fontSize: 11, color: AppConstants.textMuted, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Container(
                      height: 38,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppConstants.borderColor),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: currentStatus,
                          isExpanded: true,
                          style: const TextStyle(fontSize: 12, color: AppConstants.textColor, fontWeight: FontWeight.w600),
                          items: const [
                            DropdownMenuItem(value: 'open', child: Text('Open')),
                            DropdownMenuItem(value: 'in_progress', child: Text('In Progress')),
                            DropdownMenuItem(value: 'resolved', child: Text('Resolved')),
                            DropdownMenuItem(value: 'closed', child: Text('Closed')),
                          ],
                          onChanged: (val) {
                            if (val != null) _handleStatusChange(val);
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),

              // Priority Dropdown
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Priority', style: TextStyle(fontSize: 11, color: AppConstants.textMuted, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Container(
                      height: 38,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppConstants.borderColor),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: currentPriority,
                          isExpanded: true,
                          style: const TextStyle(fontSize: 12, color: AppConstants.textColor, fontWeight: FontWeight.w600),
                          items: const [
                            DropdownMenuItem(value: 'low', child: Text('Low')),
                            DropdownMenuItem(value: 'normal', child: Text('Normal')),
                            DropdownMenuItem(value: 'high', child: Text('High')),
                            DropdownMenuItem(value: 'urgent', child: Text('Urgent')),
                          ],
                          onChanged: (val) {
                            if (val != null) _handlePriorityChange(val);
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Metadata row (Created date & ID)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Created: $createdStr', style: const TextStyle(fontSize: 11, color: AppConstants.textMuted)),
              InkWell(
                onTap: () => _copyToClipboard(ticket.id, 'Ticket ID'),
                child: Text('ID: ${ticket.id.substring(0, 8)}... (copy)', style: const TextStyle(fontSize: 11, color: AppConstants.primaryColor)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(TicketMessage message) {
    final timeStr = DateFormat('MMM d, h:mm a').format(message.createdAt);

    if (message.isInternalNote) {
      // INTERNAL NOTE: Clear distinct amber styling, marked with security warning
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppConstants.internalNoteBg,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppConstants.internalNoteBorder.withValues(alpha: 0.5)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.lock, size: 14, color: AppConstants.internalNoteText),
                const SizedBox(width: 6),
                const Text(
                  'INTERNAL NOTE — NOT VISIBLE TO CUSTOMER',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: AppConstants.internalNoteText,
                    letterSpacing: 0.2,
                  ),
                ),
                const Spacer(),
                Text(timeStr, style: TextStyle(fontSize: 10, color: Colors.amber.shade900)),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              message.message,
              style: const TextStyle(fontSize: 13, color: Color(0xFF451A03), height: 1.4),
            ),
          ],
        ),
      );
    }

    final isDeveloper = message.isDeveloper;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: isDeveloper ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          // Header info
          Padding(
            padding: const EdgeInsets.only(bottom: 4, left: 4, right: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isDeveloper ? 'Developer (You)' : 'Customer',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: isDeveloper ? AppConstants.primaryColor : AppConstants.textColor,
                  ),
                ),
                const SizedBox(width: 6),
                Text(timeStr, style: const TextStyle(fontSize: 10, color: AppConstants.textMuted)),
              ],
            ),
          ),
          // Bubble
          Container(
            constraints: const BoxConstraints(maxWidth: 320),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isDeveloper ? AppConstants.primaryColor : Colors.white,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(12),
                topRight: const Radius.circular(12),
                bottomLeft: Radius.circular(isDeveloper ? 12 : 2),
                bottomRight: Radius.circular(isDeveloper ? 2 : 12),
              ),
              border: isDeveloper ? null : Border.all(color: AppConstants.borderColor),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 3,
                  offset: const Offset(0, 1),
                ),
              ],
            ),
            child: Text(
              message.message,
              style: TextStyle(
                fontSize: 13,
                color: isDeveloper ? Colors.white : AppConstants.textColor,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComposer() {
    final isNote = _composerMode == 1;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppConstants.borderColor)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Mode Selector Tabs (Public Reply vs Internal Note)
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _composerMode = 0),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      decoration: BoxDecoration(
                        color: _composerMode == 0 ? AppConstants.primaryColor.withValues(alpha: 0.12) : Colors.transparent,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      alignment: Alignment.center,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.reply, size: 14, color: _composerMode == 0 ? AppConstants.primaryColor : AppConstants.textMuted),
                          const SizedBox(width: 4),
                          Text(
                            'Public Reply',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: _composerMode == 0 ? FontWeight.bold : FontWeight.normal,
                              color: _composerMode == 0 ? AppConstants.primaryColor : AppConstants.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _composerMode = 1),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      decoration: BoxDecoration(
                        color: _composerMode == 1 ? AppConstants.internalNoteBg : Colors.transparent,
                        borderRadius: BorderRadius.circular(6),
                        border: _composerMode == 1 ? Border.all(color: AppConstants.internalNoteBorder) : null,
                      ),
                      alignment: Alignment.center,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.lock, size: 14, color: _composerMode == 1 ? AppConstants.internalNoteText : AppConstants.textMuted),
                          const SizedBox(width: 4),
                          Text(
                            'Internal Note',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: _composerMode == 1 ? FontWeight.bold : FontWeight.normal,
                              color: _composerMode == 1 ? AppConstants.internalNoteText : AppConstants.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            if (isNote) ...[
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppConstants.internalNoteBg,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppConstants.internalNoteBorder),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.shield_outlined, size: 14, color: AppConstants.internalNoteText),
                    SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'INTERNAL NOTE — Strictly invisible to customer in all views/APIs',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: AppConstants.internalNoteText,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Input Row
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: isNote ? AppConstants.internalNoteBg.withValues(alpha: 0.4) : const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: isNote ? AppConstants.internalNoteBorder : AppConstants.borderColor),
                    ),
                    child: TextField(
                      controller: _messageController,
                      maxLines: 4,
                      minLines: 1,
                      decoration: InputDecoration(
                        hintText: isNote ? 'Write an internal note (invisible to customer)...' : 'Type reply to customer...',
                        hintStyle: TextStyle(
                          fontSize: 13,
                          color: isNote ? AppConstants.internalNoteText.withValues(alpha: 0.6) : AppConstants.textMuted,
                        ),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      ),
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 42,
                  child: ElevatedButton(
                    onPressed: _isSending ? null : () => _handleSubmitMessage(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: isNote ? AppConstants.internalNoteBorder : AppConstants.primaryColor,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      elevation: 0,
                    ),
                    child: _isSending
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(isNote ? Icons.lock : Icons.send, size: 16),
                              const SizedBox(width: 4),
                              Text(isNote ? 'Save' : 'Send', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                            ],
                          ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

