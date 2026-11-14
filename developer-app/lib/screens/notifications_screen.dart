import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../constants.dart';
import '../services/api_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Form State
  String _audience = 'all'; // 'all' or 'single'
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  final TextEditingController _customerSearchController = TextEditingController();

  Map<String, dynamic>? _selectedCustomer;
  List<Map<String, dynamic>> _customerSearchResults = [];
  bool _isSearchingCustomers = false;
  String? _customerSearchError;
  Timer? _searchDebounceTimer;

  bool _isSending = false;
  String? _statusFeedback;
  bool _isSuccessFeedback = true;

  // History State
  List<Map<String, dynamic>> _history = [];
  bool _isLoadingHistory = true;
  String? _historyError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.index == 1 && !_tabController.indexIsChanging) {
        _loadHistory();
      }
    });
    _titleController.addListener(() => setState(() {}));
    _messageController.addListener(() => setState(() {}));
    _loadHistory();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _titleController.dispose();
    _messageController.dispose();
    _customerSearchController.dispose();
    _searchDebounceTimer?.cancel();
    super.dispose();
  }

  void _onCustomerSearchChanged(String query) {
    // If user modifies search input after selecting a customer, clear selection
    if (_selectedCustomer != null && query.trim() != (_selectedCustomer!['user_email'] ?? '')) {
      setState(() {
        _selectedCustomer = null;
      });
    }

    _searchDebounceTimer?.cancel();
    _searchDebounceTimer = Timer(const Duration(milliseconds: 300), () {
      _searchCustomers(query);
    });
  }

  Future<void> _searchCustomers(String query) async {
    setState(() {
      _isSearchingCustomers = true;
      _customerSearchError = null;
    });

    try {
      final results = await ApiService().getCustomers(search: query.trim());
      if (!mounted) return;
      setState(() {
        _customerSearchResults = results;
        _isSearchingCustomers = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _customerSearchResults = [];
        _customerSearchError = e.toString().replaceAll('Exception: ', '');
        _isSearchingCustomers = false;
      });
    }
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoadingHistory = true;
      _historyError = null;
    });

    try {
      final list = await ApiService().getNotificationHistory(limit: 50);
      if (!mounted) return;
      setState(() {
        _history = list;
        _isLoadingHistory = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _historyError = e.toString().replaceAll('Exception: ', '');
        _isLoadingHistory = false;
      });
    }
  }

  Future<void> _confirmAndSend() async {
    final title = _titleController.text.trim();
    final body = _messageController.text.trim();

    if (title.isEmpty) {
      _showBanner('Please enter a notification title', isSuccess: false);
      return;
    }

    if (body.isEmpty) {
      _showBanner('Please enter a notification message', isSuccess: false);
      return;
    }

    if (_audience == 'single' && _selectedCustomer == null) {
      _showBanner('Please search and select a customer recipient', isSuccess: false);
      return;
    }

    final recipientEmail = _selectedCustomer?['user_email'];

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.campaign, color: AppConstants.primaryColor),
            SizedBox(width: 8),
            Text('Confirm Push Notification', style: TextStyle(fontSize: 18)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _audience == 'all'
                  ? 'Target: All Registered Customers (Broadcast)'
                  : 'Target: $recipientEmail (Direct)',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 12),
            const Text('Title:', style: TextStyle(fontWeight: FontWeight.w600, color: AppConstants.textMuted, fontSize: 12)),
            Text(title, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 8),
            const Text('Message:', style: TextStyle(fontWeight: FontWeight.w600, color: AppConstants.textMuted, fontSize: 12)),
            Text(body, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 16),
            const Text(
              'Are you sure you want to send this push notification?',
              style: TextStyle(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.w500),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppConstants.primaryColor,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('Send Notification', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isSending = true;
      _statusFeedback = null;
    });

    try {
      final res = await ApiService().sendCustomNotification(
        title: title,
        body: body,
        audience: _audience,
        recipientEmail: recipientEmail,
      );

      if (!mounted) return;

      final status = res['status'] ?? 'completed';
      final statusText = status == 'completed'
          ? 'Notification successfully sent and delivered!'
          : 'Notification enqueued for delivery (status: $status).';

      _showBanner(statusText, isSuccess: true);

      // Reset form
      _titleController.clear();
      _messageController.clear();
      _customerSearchController.clear();
      setState(() {
        _selectedCustomer = null;
        _customerSearchResults.clear();
        _isSending = false;
        _statusFeedback = statusText;
        _isSuccessFeedback = true;
      });

      // Refresh history in background
      _loadHistory();
    } catch (e) {
      if (!mounted) return;
      final err = e.toString().replaceAll('Exception: ', '');
      _showBanner(err, isSuccess: false);
      setState(() {
        _isSending = false;
        _statusFeedback = err;
        _isSuccessFeedback = false;
      });
    }
  }

  void _showBanner(String message, {required bool isSuccess}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isSuccess ? AppConstants.accentColor : Colors.red.shade700,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 4),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppConstants.backgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppConstants.primaryColor,
          unselectedLabelColor: AppConstants.textMuted,
          indicatorColor: AppConstants.primaryColor,
          indicatorWeight: 3,
          tabs: const [
            Tab(icon: Icon(Icons.send_rounded), text: 'Compose'),
            Tab(icon: Icon(Icons.history_rounded), text: 'History'),
          ],
        ),
        title: const Text(
          'Push Notifications',
          style: TextStyle(
            color: AppConstants.textColor,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
        iconTheme: const IconThemeData(color: AppConstants.textColor),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildComposeTab(),
          _buildHistoryTab(),
        ],
      ),
    );
  }

  // ==========================================================================
  // COMPOSE TAB
  // ==========================================================================
  Widget _buildComposeTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Feedback Card (if any)
        if (_statusFeedback != null) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _isSuccessFeedback
                  ? AppConstants.accentColor.withValues(alpha: 0.1)
                  : Colors.red.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _isSuccessFeedback
                    ? AppConstants.accentColor
                    : Colors.red.shade300,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  _isSuccessFeedback ? Icons.check_circle : Icons.error,
                  color: _isSuccessFeedback
                      ? AppConstants.accentColor
                      : Colors.red.shade700,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _statusFeedback!,
                    style: TextStyle(
                      color: _isSuccessFeedback
                          ? Colors.green.shade900
                          : Colors.red.shade900,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],

        // Audience Selection Card
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppConstants.borderColor),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Target Audience',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: AppConstants.textColor,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: Icon(
                          Icons.groups,
                          color: _audience == 'all'
                              ? Colors.white
                              : AppConstants.textColor,
                          size: 18,
                        ),
                        label: Text(
                          'All Customers',
                          style: TextStyle(
                            color: _audience == 'all'
                                ? Colors.white
                                : AppConstants.textColor,
                            fontWeight: _audience == 'all'
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: _audience == 'all'
                              ? AppConstants.primaryColor
                              : Colors.transparent,
                          side: BorderSide(
                            color: _audience == 'all'
                                ? AppConstants.primaryColor
                                : AppConstants.borderColor,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () {
                          setState(() {
                            _audience = 'all';
                            _selectedCustomer = null;
                            _customerSearchResults.clear();
                          });
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: Icon(
                          Icons.person,
                          color: _audience == 'single'
                              ? Colors.white
                              : AppConstants.textColor,
                          size: 18,
                        ),
                        label: Text(
                          'Specific User',
                          style: TextStyle(
                            color: _audience == 'single'
                                ? Colors.white
                                : AppConstants.textColor,
                            fontWeight: _audience == 'single'
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: _audience == 'single'
                              ? AppConstants.primaryColor
                              : Colors.transparent,
                          side: BorderSide(
                            color: _audience == 'single'
                                ? AppConstants.primaryColor
                                : AppConstants.borderColor,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () {
                          setState(() {
                            _audience = 'single';
                          });
                          if (_customerSearchResults.isEmpty && _selectedCustomer == null) {
                            _searchCustomers('');
                          }
                        },
                      ),
                    ),
                  ],
                ),

                // Specific Customer Selector
                if (_audience == 'single') ...[
                  const SizedBox(height: 16),
                  
                  // Selected Customer Pill / Card
                  if (_selectedCustomer != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.green.shade50,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.green.shade300),
                      ),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 16,
                            backgroundColor: Colors.green.shade700,
                            child: const Icon(Icons.check, size: 18, color: Colors.white),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Text(
                                      'Selected Customer:',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                        color: Colors.green,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                      decoration: BoxDecoration(
                                        color: Colors.green.shade200,
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        _selectedCustomer!['device_platform'] == 'android'
                                            ? 'Android'
                                            : 'Registered',
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.green.shade900,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _selectedCustomer!['user_email'] ?? 'Unknown',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: Colors.green.shade900,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, size: 20),
                            color: Colors.grey.shade700,
                            tooltip: 'Change customer',
                            onPressed: () {
                              setState(() {
                                _selectedCustomer = null;
                                _customerSearchController.clear();
                              });
                              _searchCustomers('');
                            },
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    // Search Input
                    TextField(
                      controller: _customerSearchController,
                      decoration: InputDecoration(
                        labelText: 'Search Customer by Email',
                        hintText: 'Type email to find registered user...',
                        prefixIcon: const Icon(Icons.search, size: 20),
                        suffixIcon: _isSearchingCustomers
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: Padding(
                                  padding: EdgeInsets.all(12),
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                              )
                            : (_customerSearchController.text.isNotEmpty
                                ? IconButton(
                                    icon: const Icon(Icons.clear, size: 18),
                                    onPressed: () {
                                      _customerSearchController.clear();
                                      _searchCustomers('');
                                    },
                                  )
                                : null),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide:
                              const BorderSide(color: AppConstants.borderColor),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 12),
                      ),
                      onChanged: _onCustomerSearchChanged,
                    ),

                    // Error indicator
                    if (_customerSearchError != null) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.red.shade200),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, color: Colors.red, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _customerSearchError!,
                                style: const TextStyle(fontSize: 12, color: Colors.red),
                              ),
                            ),
                            TextButton(
                              onPressed: () => _searchCustomers(_customerSearchController.text),
                              child: const Text('Retry', style: TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // Suggestions list
                    if (_customerSearchResults.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Container(
                        constraints: const BoxConstraints(maxHeight: 220),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppConstants.borderColor),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.05),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: _customerSearchResults.length,
                          separatorBuilder: (_, __) =>
                              const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            final cust = _customerSearchResults[i];
                            final email = cust['user_email'] ?? 'Customer';
                            final platform = cust['device_platform'] ?? 'Device';
                            final active = cust['is_active'] == true;

                            return ListTile(
                              dense: true,
                              leading: CircleAvatar(
                                radius: 14,
                                backgroundColor: active
                                    ? Colors.green.shade100
                                    : Colors.grey.shade200,
                                child: Icon(
                                  active ? Icons.phone_android : Icons.person_outline,
                                  color: active ? Colors.green.shade800 : Colors.grey.shade700,
                                  size: 16,
                                ),
                              ),
                              title: Text(
                                email,
                                style: const TextStyle(
                                    fontSize: 13, fontWeight: FontWeight.bold),
                              ),
                              subtitle: Text(
                                active ? 'Active on $platform (Ready for push)' : 'Registered customer',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: active ? Colors.green.shade700 : AppConstants.textMuted,
                                ),
                              ),
                              trailing: const Icon(Icons.arrow_forward_ios, size: 12, color: AppConstants.textMuted),
                              onTap: () {
                                setState(() {
                                  _selectedCustomer = cust;
                                  _customerSearchController.text = email;
                                  _customerSearchResults.clear();
                                });
                              },
                            );
                          },
                        ),
                      ),
                    ] else if (!_isSearchingCustomers &&
                        _customerSearchError == null &&
                        _customerSearchController.text.trim().isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.grey.shade200),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.search_off, size: 18, color: AppConstants.textMuted),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'No registered customer found matching "${_customerSearchController.text.trim()}"',
                                style: const TextStyle(fontSize: 12, color: AppConstants.textMuted),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Message Content Card
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppConstants.borderColor),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Notification Content',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: AppConstants.textColor,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _titleController,
                  maxLength: 255,
                  decoration: InputDecoration(
                    labelText: 'Notification Title',
                    hintText: 'e.g. New Feature Announcement',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 12),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _messageController,
                  maxLines: 4,
                  maxLength: 4000,
                  decoration: InputDecoration(
                    labelText: 'Notification Message',
                    hintText: 'Enter the message content to deliver to customer devices...',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 12),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Live Preview Card
        const Text(
          'Notification Preview',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 14,
            color: AppConstants.textMuted,
          ),
        ),
        const SizedBox(height: 8),
        _buildNotificationPreview(),
        const SizedBox(height: 24),

        // Send Button
        SizedBox(
          height: 48,
          child: ElevatedButton.icon(
            icon: _isSending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Icon(Icons.send_rounded, color: Colors.white),
            label: Text(
              _isSending ? 'Dispatching...' : 'Send Push Notification',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppConstants.primaryColor,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            onPressed: _isSending ? null : _confirmAndSend,
          ),
        ),
        const SizedBox(height: 32),
      ],
    );
  }

  Widget _buildNotificationPreview() {
    final title = _titleController.text.trim();
    final body = _messageController.text.trim();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B), // Android notification shade slate
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: AppConstants.primaryColor,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Icon(Icons.check, color: Colors.white, size: 14),
              ),
              const SizedBox(width: 8),
              const Text(
                'Taskly',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 6),
              const Text(
                '•  now',
                style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  _audience == 'all'
                      ? 'BROADCAST'
                      : (_selectedCustomer != null ? 'DIRECT TO RECIPIENT' : 'DIRECT'),
                  style: const TextStyle(
                    color: Color(0xFF38BDF8),
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            title.isNotEmpty ? title : 'Notification Title Placeholder',
            style: TextStyle(
              color: title.isNotEmpty ? Colors.white : Colors.white54,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            body.isNotEmpty ? body : 'Your push notification message content will appear here...',
            style: TextStyle(
              color: body.isNotEmpty ? const Color(0xFFE2E8F0) : const Color(0xFF94A3B8),
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // HISTORY TAB
  // ==========================================================================
  Widget _buildHistoryTab() {
    if (_isLoadingHistory) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_historyError != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.redAccent),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                _historyError!,
                style: const TextStyle(color: Colors.red),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
              onPressed: _loadHistory,
            ),
          ],
        ),
      );
    }

    if (_history.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history, size: 48, color: Colors.grey.shade400),
            const SizedBox(height: 12),
            const Text(
              'No custom notification history yet',
              style: TextStyle(color: AppConstants.textMuted, fontSize: 15),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Refresh'),
              onPressed: _loadHistory,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadHistory,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _history.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (ctx, i) {
          final item = _history[i];
          final eventType = item['event_type'] ?? '';
          final isBroadcast = eventType == 'admin_custom_broadcast' || item['audience'] == 'broadcast';
          final recipient = item['recipient_email'] ?? (isBroadcast ? 'All Customers' : 'Direct Customer');
          final status = (item['status'] ?? 'pending').toString().toLowerCase();
          final title = item['title'] ?? 'Notification';
          final body = item['body'] ?? '';
          final createdAt = item['created_at'];

          String formattedDate = '';
          if (createdAt != null) {
            try {
              final dt = DateTime.parse(createdAt).toLocal();
              formattedDate = DateFormat('MMM d, y • h:mm a').format(dt);
            } catch (_) {}
          }

          Color statusColor;
          IconData statusIcon;
          switch (status) {
            case 'completed':
              statusColor = Colors.green;
              statusIcon = Icons.check_circle;
              break;
            case 'processing':
              statusColor = Colors.orange;
              statusIcon = Icons.sync;
              break;
            case 'failed':
            case 'dead_letter':
              statusColor = Colors.red;
              statusIcon = Icons.error;
              break;
            default:
              statusColor = Colors.blue;
              statusIcon = Icons.schedule;
          }

          return Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: AppConstants.borderColor),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: isBroadcast
                              ? AppConstants.primaryColor.withValues(alpha: 0.1)
                              : Colors.purple.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          isBroadcast ? 'BROADCAST' : 'DIRECT',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: isBroadcast ? AppConstants.primaryColor : Colors.purple,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          recipient,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppConstants.textMuted,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(statusIcon, color: statusColor, size: 14),
                          const SizedBox(width: 4),
                          Text(
                            status.toUpperCase(),
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: statusColor,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: AppConstants.textColor,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    body,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF475569),
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (formattedDate.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      formattedDate,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppConstants.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
