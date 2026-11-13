import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../constants.dart';
import '../models/dashboard_stats.dart';
import '../models/ticket.dart';
import '../services/api_service.dart';
import 'login_screen.dart';
import 'ticket_detail_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  DashboardStats _stats = DashboardStats.empty();
  List<Ticket> _tickets = [];
  bool _isLoading = true;
  String? _errorMessage;

  String _selectedStatus = 'all';
  final TextEditingController _searchController = TextEditingController();

  final List<Map<String, String>> _statusFilters = [
    {'label': 'All Tickets', 'value': 'all'},
    {'label': 'Open', 'value': 'open'},
    {'label': 'In Progress', 'value': 'in_progress'},
    {'label': 'Resolved', 'value': 'resolved'},
    {'label': 'Closed', 'value': 'closed'},
  ];

  @override
  void initState() {
    super.initState();
    _loadDashboardData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadDashboardData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final statsFuture = ApiService().getStats();
      final ticketsFuture = ApiService().getTickets(
        status: _selectedStatus == 'all' ? null : _selectedStatus,
        search: _searchController.text.trim(),
      );

      final results = await Future.wait([statsFuture, ticketsFuture]);
      if (!mounted) return;

      setState(() {
        _stats = results[0] as DashboardStats;
        _tickets = results[1] as List<Ticket>;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  void _onStatusFilterSelected(String status) {
    if (_selectedStatus != status) {
      setState(() {
        _selectedStatus = status;
      });
      _loadDashboardData();
    }
  }

  void _onSearchSubmitted(String _) {
    _loadDashboardData();
  }

  Future<void> _handleLogout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out of Taskly Developer?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Sign Out', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await ApiService().signOut();
      if (!mounted) return;
      setState(() {
        _tickets.clear();
        _stats = DashboardStats.empty();
      });
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'open':
        return AppConstants.statusOpen;
      case 'in_progress':
        return AppConstants.statusInProgress;
      case 'resolved':
        return AppConstants.statusResolved;
      case 'closed':
        return AppConstants.statusClosed;
      default:
        return AppConstants.textMuted;
    }
  }

  Color _getPriorityColor(String priority) {
    switch (priority.toLowerCase()) {
      case 'urgent':
        return Colors.red.shade600;
      case 'high':
        return Colors.orange.shade700;
      case 'low':
        return Colors.blueGrey;
      default:
        return Colors.grey.shade700;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppConstants.backgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        titleSpacing: 16,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: AppConstants.borderColor, height: 1.0),
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppConstants.primaryColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.admin_panel_settings, color: AppConstants.primaryColor, size: 20),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Taskly Developer',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppConstants.textColor,
                  ),
                ),
                Text(
                  AppConstants.authorizedAdminEmail,
                  style: TextStyle(
                    fontSize: 11,
                    color: AppConstants.textMuted,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppConstants.textColor),
            tooltip: 'Refresh',
            onPressed: _loadDashboardData,
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppConstants.textMuted),
            tooltip: 'Sign Out',
            onPressed: _handleLogout,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboardData,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Metrics Dashboard Cards
              Row(
                children: [
                  Expanded(
                    child: _buildMetricCard(
                      'Total Tickets',
                      _stats.total.toString(),
                      Icons.inbox_outlined,
                      AppConstants.primaryColor,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildMetricCard(
                      'Open',
                      _stats.open.toString(),
                      Icons.radio_button_checked,
                      AppConstants.statusOpen,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildMetricCard(
                      'In Progress',
                      _stats.inProgress.toString(),
                      Icons.pending_actions,
                      AppConstants.statusInProgress,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildMetricCard(
                      'Resolved',
                      _stats.resolved.toString(),
                      Icons.check_circle_outline,
                      AppConstants.statusResolved,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Search Bar
              TextField(
                controller: _searchController,
                textInputAction: TextInputAction.search,
                onSubmitted: _onSearchSubmitted,
                decoration: InputDecoration(
                  hintText: 'Search by ID, subject, or customer email...',
                  hintStyle: const TextStyle(fontSize: 13, color: AppConstants.textMuted),
                  prefixIcon: const Icon(Icons.search, size: 20, color: AppConstants.textMuted),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            _loadDashboardData();
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppConstants.borderColor),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppConstants.borderColor),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Filter Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: _statusFilters.map((f) {
                    final isSelected = _selectedStatus == f['value'];
                    return Padding(
                      padding: const EdgeInsets.only(right: 8.0),
                      child: FilterChip(
                        label: Text(f['label']!),
                        selected: isSelected,
                        onSelected: (_) => _onStatusFilterSelected(f['value']!),
                        selectedColor: AppConstants.primaryColor.withValues(alpha: 0.12),
                        checkmarkColor: AppConstants.primaryColor,
                        labelStyle: TextStyle(
                          fontSize: 12,
                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                          color: isSelected ? AppConstants.primaryColor : AppConstants.textColor,
                        ),
                        backgroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                          side: BorderSide(
                            color: isSelected ? AppConstants.primaryColor : AppConstants.borderColor,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 16),

              // Error or Ticket List
              if (_errorMessage != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, color: Colors.red.shade700),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: TextStyle(color: Colors.red.shade900, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                )
              else if (_isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40.0),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_tickets.isEmpty)
                Container(
                  padding: const EdgeInsets.all(36),
                  alignment: Alignment.center,
                  child: Column(
                    children: [
                      Icon(Icons.inbox, size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 12),
                      const Text(
                        'No support tickets found',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppConstants.textColor,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _selectedStatus != 'all'
                            ? 'Try switching the status filter.'
                            : 'When customers submit tickets, they will appear here.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12, color: AppConstants.textMuted),
                      ),
                    ],
                  ),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _tickets.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final ticket = _tickets[index];
                    return _buildTicketCard(ticket);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCard(String title, String count, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppConstants.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppConstants.textMuted,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Icon(icon, size: 14, color: color),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            count,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTicketCard(Ticket ticket) {
    final statusColor = _getStatusColor(ticket.status);
    final priorityColor = _getPriorityColor(ticket.priority);
    final timeStr = DateFormat('MMM d, h:mm a').format(ticket.updatedAt);

    return InkWell(
      onTap: () async {
        final result = await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => TicketDetailScreen(ticketId: ticket.id),
          ),
        );
        if (result == true) {
          _loadDashboardData();
        }
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppConstants.borderColor),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 4,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status & Priority & Time row
            Row(
              children: [
                // Status pill
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    ticket.status.toUpperCase().replaceAll('_', ' '),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                // Priority pill
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: priorityColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    ticket.priority.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: priorityColor,
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  timeStr,
                  style: const TextStyle(fontSize: 11, color: AppConstants.textMuted),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Subject
            Text(
              ticket.subject,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: AppConstants.textColor,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 8),

            // Verified Customer Email
            Row(
              children: [
                const Icon(Icons.verified_user_outlined, size: 14, color: AppConstants.primaryColor),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    ticket.userEmail,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppConstants.textColor,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    ticket.category.toUpperCase(),
                    style: const TextStyle(fontSize: 10, color: AppConstants.textMuted),
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

