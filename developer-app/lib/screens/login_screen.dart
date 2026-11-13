import 'package:flutter/material.dart';
import '../constants.dart';
import '../services/api_service.dart';
import '../services/push_notification_service.dart';
import 'dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController(text: AppConstants.authorizedAdminEmail);
  final _passwordController = TextEditingController();
  final _serverController = TextEditingController(text: AppConstants.defaultApiUrl);

  BackendEnvironment _selectedEnv = BackendEnvironment.staging;
  bool _obscurePassword = true;
  bool _isLoading = false;
  bool _isCheckingHealth = false;
  bool _showServerConfig = false;
  String? _errorMessage;
  String? _healthStatus;
  bool _healthSuccess = false;

  @override
  void initState() {
    super.initState();
    _loadSavedServer();
  }

  Future<void> _loadSavedServer() async {
    final serverUrl = await ApiService().getServerUrl();
    setState(() {
      _serverController.text = serverUrl;
      if (serverUrl == AppConstants.stagingApiUrl) {
        _selectedEnv = BackendEnvironment.staging;
      } else {
        _selectedEnv = BackendEnvironment.custom;
      }
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _serverController.dispose();
    super.dispose();
  }

  void _onEnvSelected(BackendEnvironment env) {
    setState(() {
      _selectedEnv = env;
      _healthStatus = null;
      switch (env) {
        case BackendEnvironment.staging:
          _serverController.text = AppConstants.stagingApiUrl;
          break;
        case BackendEnvironment.custom:
          break;
      }
    });
  }

  Future<void> _testConnection() async {
    setState(() {
      _isCheckingHealth = true;
      _healthStatus = null;
      _errorMessage = null;
    });

    try {
      final target = _serverController.text.trim();
      final health = await ApiService().checkHealth(url: target);
      final service = health['service'] ?? 'taskly-backend';
      final version = health['version'] ?? '2.2.0';
      final env = health['environment'] ?? 'unknown';

      if (!mounted) return;
      setState(() {
        _healthSuccess = true;
        _healthStatus = 'Online: $service v$version ($env)';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _healthSuccess = false;
        _healthStatus = e.toString().replaceAll('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingHealth = false;
        });
      }
    }
  }

  Future<void> _handleLogin() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _healthStatus = null;
    });

    try {
      final email = _emailController.text.trim();
      final password = _passwordController.text.trim();
      final serverUrl = _serverController.text.trim();

      if (email.isEmpty || password.isEmpty) {
        throw Exception('Please enter credentials.');
      }

      await ApiService().login(
        email: email,
        password: password,
        serverUrl: serverUrl.isNotEmpty ? serverUrl : null,
      );

      // Register FCM device token with Supabase for the authenticated developer
      try {
        await DeveloperPushNotificationService().syncTokenToSupabase();
      } catch (err) {
        debugPrint('[Login] Push token sync warning: $err');
      }

      if (!mounted) return;

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const DashboardScreen()),
        (route) => false,
      );
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppConstants.backgroundColor,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 32.0),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                elevation: 3,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: const BorderSide(color: AppConstants.borderColor),
                ),
                color: AppConstants.cardColor,
                child: Padding(
                  padding: const EdgeInsets.all(28.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Header Badge & Icon
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppConstants.primaryColor.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.admin_panel_settings_rounded,
                            size: 40,
                            color: AppConstants.primaryColor,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Taskly Developer',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: AppConstants.textColor,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Single-Administrator Support Portal',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: AppConstants.textMuted,
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Single-Admin Security Notice
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.blue.shade50,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.blue.shade200),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.shield_outlined, size: 18, color: Colors.blue.shade800),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Authorized Access Only: Exclusively restricted to ${AppConstants.authorizedAdminEmail}.',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.blue.shade900,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Error Alert Banner
                      if (_errorMessage != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.red.shade50,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.red.shade200),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.error_outline, size: 18, color: Colors.red.shade800),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.red.shade900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      // Email Field (Admin only)
                      const Text(
                        'Admin Email',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppConstants.textColor,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _emailController,
                        readOnly: true, // Strictly fixed to authorized single-admin
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.email_outlined, size: 20),
                          filled: true,
                          fillColor: const Color(0xFFF1F5F9),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: AppConstants.borderColor),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: AppConstants.borderColor),
                          ),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          helperText: 'Locked to single authorized admin identity',
                          helperStyle: const TextStyle(fontSize: 11, color: AppConstants.textMuted),
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Administrator Password Field
                      const Text(
                        'Administrator Password',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppConstants.textColor,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.lock_outline, size: 20),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                              size: 20,
                            ),
                            onPressed: () {
                              setState(() {
                                _obscurePassword = !_obscurePassword;
                              });
                            },
                          ),
                          hintText: 'Enter administrator password',
                          hintStyle: const TextStyle(fontSize: 13, color: AppConstants.textMuted),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: AppConstants.borderColor),
                          ),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Server Config Toggle
                      GestureDetector(
                        onTap: () {
                          setState(() {
                            _showServerConfig = !_showServerConfig;
                          });
                        },
                        child: Row(
                          children: [
                            Icon(
                              _showServerConfig ? Icons.arrow_drop_down : Icons.arrow_right,
                              color: AppConstants.textMuted,
                            ),
                            const Text(
                              'Server Endpoint Configuration',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppConstants.textMuted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (_showServerConfig) ...[
                        const SizedBox(height: 10),
                        // Environment Selector Chips
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            ChoiceChip(
                              label: const Text('Developer Backend (HTTPS)', style: TextStyle(fontSize: 11)),
                              selected: _selectedEnv == BackendEnvironment.staging,
                              onSelected: (_) => _onEnvSelected(BackendEnvironment.staging),
                            ),
                            ChoiceChip(
                              label: const Text('Custom (HTTPS)', style: TextStyle(fontSize: 11)),
                              selected: _selectedEnv == BackendEnvironment.custom,
                              onSelected: (_) => _onEnvSelected(BackendEnvironment.custom),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _serverController,
                          decoration: InputDecoration(
                            prefixIcon: const Icon(Icons.dns_outlined, size: 18),
                            labelText: 'API Base URL',
                            labelStyle: const TextStyle(fontSize: 12),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          ),
                          style: const TextStyle(fontSize: 12),
                          onChanged: (_) {
                            setState(() {
                              _selectedEnv = BackendEnvironment.custom;
                              _healthStatus = null;
                            });
                          },
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            OutlinedButton.icon(
                              onPressed: _isCheckingHealth ? null : _testConnection,
                              icon: _isCheckingHealth
                                  ? const SizedBox(
                                      width: 12,
                                      height: 12,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    )
                                  : const Icon(Icons.network_check_outlined, size: 14),
                              label: const Text('Test Connection', style: TextStyle(fontSize: 11)),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _healthStatus != null
                                  ? Text(
                                      _healthStatus!,
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w600,
                                        color: _healthSuccess ? Colors.green.shade700 : Colors.red.shade700,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    )
                                  : const SizedBox.shrink(),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 24),

                      // Login Button
                      SizedBox(
                        height: 48,
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _handleLogin,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppConstants.primaryColor,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            elevation: 0,
                          ),
                          child: _isLoading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text(
                                  'Sign In as Administrator',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
