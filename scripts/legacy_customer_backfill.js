/**
 * Taskly Legacy Customer Account Backfill & Eligibility Verification Utility
 * File: scripts/legacy_customer_backfill.js
 * 
 * Safety Rules:
 * 1. Default mode is DRY-RUN (read-only). Zero metadata modifications occur unless explicitly invoked with --execute.
 * 2. Strictly excludes developer administrator (tasklypets@gmail.com). Developer administrator exclusion is checked FIRST.
 * 3. Strictly excludes unverified / unconfirmed Supabase Auth accounts.
 * 4. Strictly requires BOTH valid customer name AND authoritative database customer activity records.
 *    if (!hasCustomerEvidence || !nameValidation.valid) -> EXCLUDED_INCOMPLETE_AMBIGUOUS.
 * 5. Requires valid customer name that passes backend validation rules.
 * 6. Idempotent: Accounts already possessing app_metadata.is_customer === true are skipped without modification.
 */

const { createClient } = require('/Users/vimaljayganthan/Documents/ToDo/node_modules/@supabase/supabase-js');
const { validateCustomerRegistrationPayload } = require('../services/customerEligibility');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

const isExecuteMode = process.argv.includes('--execute');

const DEVELOPER_ADMIN_EMAILS = new Set([
  'tasklypets@gmail.com'
]);

function isEmailConfirmed(user) {
  return Boolean(
    user?.email_confirmed_at ||
    user?.confirmed_at ||
    (user?.app_metadata && user?.app_metadata.provider && user?.app_metadata.provider !== 'email')
  );
}

/**
 * Pure evaluation function for account backfill eligibility.
 * 
 * Precedence Order:
 * 1. Developer Administrator check (must be FIRST, even before already-customer).
 * 2. Already customer check (idempotency).
 * 3. Email verification check (must be confirmed).
 * 4. BOTH customer activity evidence AND valid profile name (Boolean OR on failure: !evidence || !name.valid).
 * 5. Eligible for backfill.
 */
function evaluateAccountEligibility(user, { customerTokens = [], developerTokens = [], ticketCount = 0, todoCount = 0, habitCount = 0 } = {}) {
  const cleanEmail = (user?.email || '').toLowerCase().trim();
  const confirmed = isEmailConfirmed(user);
  const isAdmin = DEVELOPER_ADMIN_EMAILS.has(cleanEmail);
  const alreadyCustomer = Boolean(user?.app_metadata && user.app_metadata.is_customer === true);

  // Extract count whether an array of tokens or numeric count is provided
  const customerTokenCount = Array.isArray(customerTokens) ? customerTokens.length : (parseInt(customerTokens, 10) || 0);
  const developerTokenCount = Array.isArray(developerTokens) ? developerTokens.length : (parseInt(developerTokens, 10) || 0);

  // Strict safety constraint: Only customerTokens count towards customer evidence.
  // developerTokens are completely excluded from customer activity.
  // Correctly handles array (.length > 0) and numeric count (> 0)
  const hasCustomerEvidence = (customerTokens?.length !== undefined ? customerTokens.length > 0 : customerTokens > 0) || ticketCount > 0 || todoCount > 0 || habitCount > 0;

  const rawName = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  const rawAge = user?.user_metadata?.age || 25;
  const nameValidation = validateCustomerRegistrationPayload({ name: rawName, age: rawAge });

  // 1. Developer Administrator check MUST come FIRST (even before alreadyCustomer)
  if (isAdmin) {
    return {
      status: 'EXCLUDED_DEVELOPER_ADMIN',
      reason: 'Account is designated Taskly Developer Administrator (tasklypets@gmail.com)',
      eligible: false,
      hasCustomerEvidence,
      nameValidation,
      customerTokenCount,
      developerTokenCount
    };
  }

  // 2. Already customer check (idempotent skip)
  if (alreadyCustomer) {
    return {
      status: 'ALREADY_CUSTOMER',
      reason: 'Account already possesses app_metadata.is_customer === true',
      eligible: false,
      hasCustomerEvidence,
      nameValidation,
      customerTokenCount,
      developerTokenCount
    };
  }

  // 3. Email verification check
  if (!confirmed) {
    return {
      status: 'EXCLUDED_UNVERIFIED',
      reason: 'Email address has not been confirmed',
      eligible: false,
      hasCustomerEvidence,
      nameValidation,
      customerTokenCount,
      developerTokenCount
    };
  }

  // 4. BOTH customer activity evidence AND valid customer name are strictly required
  // If either is missing (!hasCustomerEvidence || !nameValidation.valid), the account is excluded
  if (!hasCustomerEvidence || !nameValidation.valid) {
    let reason = '';
    if (!hasCustomerEvidence && !nameValidation.valid) {
      reason = 'Missing both valid registration profile name and database customer activity records';
    } else if (!hasCustomerEvidence) {
      reason = 'Missing authoritative database customer activity records (no customer tokens, tickets, or tasks)';
    } else {
      reason = `Invalid customer profile name: ${nameValidation.error}`;
    }
    return {
      status: 'EXCLUDED_INCOMPLETE_AMBIGUOUS',
      reason,
      eligible: false,
      hasCustomerEvidence,
      nameValidation,
      customerTokenCount,
      developerTokenCount
    };
  }

  // 5. Eligible account
  const evidenceList = [];
  if (customerTokenCount > 0) evidenceList.push(`${customerTokenCount} customer device token(s)`);
  if (ticketCount > 0) evidenceList.push(`${ticketCount} support ticket(s)`);
  if (todoCount > 0) evidenceList.push(`${todoCount} todo(s)`);
  if (habitCount > 0) evidenceList.push(`${habitCount} habit(s)`);
  if (nameValidation.valid) evidenceList.push(`verified name: "${nameValidation.cleanName}"`);

  return {
    status: 'ELIGIBLE_FOR_BACKFILL',
    reason: `Satisfies eligibility criteria. Evidence: ${evidenceList.join(', ')}`,
    eligible: true,
    hasCustomerEvidence,
    nameValidation,
    customerTokenCount,
    developerTokenCount
  };
}

async function runBackfillAudit() {
  if (!supabase) {
    console.error('[Error] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
    process.exit(1);
  }

  console.log('========================================================================');
  console.log(`TASKLY LEGACY CUSTOMER ELIGIBILITY ${isExecuteMode ? 'EXECUTION' : 'DRY RUN'}`);
  console.log('========================================================================');
  console.log(`Target Supabase URL : ${supabaseUrl}`);
  console.log(`Execution Mode      : ${isExecuteMode ? 'LIVE EXECUTION (AUTHORIZED)' : 'DRY RUN (READ-ONLY)'}`);
  console.log('------------------------------------------------------------------------\n');

  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  if (usersErr) {
    console.error('[Error] Failed to fetch auth users:', usersErr.message);
    process.exit(1);
  }

  const users = usersData.users || [];
  console.log(`Total Supabase Auth Accounts Evaluated: ${users.length}\n`);

  const report = {
    totalEvaluated: users.length,
    alreadyCustomer: 0,
    eligibleForBackfill: 0,
    excludedUnverified: 0,
    excludedDeveloperAdmin: 0,
    excludedIncompleteAmbiguous: 0,
    accounts: []
  };

  for (const user of users) {
    const cleanEmail = (user.email || '').toLowerCase().trim();
    const confirmed = isEmailConfirmed(user);

    // Query authoritative database evidence
    const [tokensRes, ticketsRes, todosRes, habitsRes] = await Promise.all([
      supabase.from('user_device_tokens').select('id, app_type, is_active').eq('user_id', user.id),
      supabase.from('support_tickets').select('id').eq('user_id', user.id),
      supabase.from('todos').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('habits').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    ]);

    const customerTokens = (tokensRes.data || []).filter(t => t.app_type === 'customer');
    const developerTokens = (tokensRes.data || []).filter(t => t.app_type === 'developer');
    const ticketCount = (ticketsRes.data || []).length;
    const todoCount = todosRes.count || 0;
    const habitCount = habitsRes.count || 0;

    const evaluation = evaluateAccountEligibility(user, {
      customerTokens,
      developerTokens,
      ticketCount,
      todoCount,
      habitCount
    });

    if (evaluation.status === 'ALREADY_CUSTOMER') {
      report.alreadyCustomer++;
    } else if (evaluation.status === 'EXCLUDED_DEVELOPER_ADMIN') {
      report.excludedDeveloperAdmin++;
    } else if (evaluation.status === 'EXCLUDED_UNVERIFIED') {
      report.excludedUnverified++;
    } else if (evaluation.status === 'EXCLUDED_INCOMPLETE_AMBIGUOUS') {
      report.excludedIncompleteAmbiguous++;
    } else if (evaluation.status === 'ELIGIBLE_FOR_BACKFILL') {
      report.eligibleForBackfill++;

      // If live execution is authorized
      if (isExecuteMode) {
        const AUTHORIZED_BACKFILL_EMAIL = 'vimaljayganthan16@gmail.com';
        if (cleanEmail !== AUTHORIZED_BACKFILL_EMAIL) {
          console.warn(`[Safety Warning] Skipping update for unauthorized account: ${cleanEmail}`);
          evaluation.reason += ` | SKIPPED: Account ${cleanEmail} is not authorized for backfill`;
        } else {
          try {
            const updatedAppMeta = {
              ...(user.app_metadata || {}),
              is_customer: true,
              customer_registered_at: new Date().toISOString(),
              backfilled_at: new Date().toISOString(),
              backfill_source: 'legacy_customer_audit'
            };
            const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
              app_metadata: updatedAppMeta
            });
            if (updateErr) {
              evaluation.reason += ` | UPDATE ERROR: ${updateErr.message}`;
            } else {
              evaluation.reason += ' | UPDATE SUCCESS: app_metadata.is_customer = true assigned';
            }
          } catch (execErr) {
            evaluation.reason += ` | EXECUTION EXCEPTION: ${execErr.message}`;
          }
        }
      }
    }

    const rawName = user.user_metadata?.full_name || user.user_metadata?.name || '';
    report.accounts.push({
      id: user.id,
      email: cleanEmail,
      confirmed,
      status: evaluation.status,
      reason: evaluation.reason,
      evidence: {
        customerTokens: customerTokens.length,
        developerTokens: developerTokens.length,
        tickets: ticketCount,
        todos: todoCount,
        habits: habitCount,
        profileName: rawName || null,
        onboardedFlag: Boolean(user.user_metadata?.onboarded || user.user_metadata?.onboarding_completed)
      }
    });
  }

  // Display structured report
  for (const acct of report.accounts) {
    console.log(`Account : ${acct.email} (${acct.id})`);
    console.log(`Status  : [${acct.status}]`);
    console.log(`Reason  : ${acct.reason}`);
    console.log(`Evidence: CustomerTokens=${acct.evidence.customerTokens}, DeveloperTokens=${acct.evidence.developerTokens}, Tickets=${acct.evidence.tickets}, Todos=${acct.evidence.todos}, Name="${acct.evidence.profileName}", Onboarded=${acct.evidence.onboardedFlag}`);
    console.log('------------------------------------------------------------------------');
  }

  console.log('\n========================================================================');
  console.log('SUMMARY AUDIT RESULTS:');
  console.log(`Total Accounts Evaluated       : ${report.totalEvaluated}`);
  console.log(`Already Had Trusted Flag       : ${report.alreadyCustomer}`);
  console.log(`Eligible for Customer Backfill : ${report.eligibleForBackfill}`);
  console.log(`Excluded (Unverified)          : ${report.excludedUnverified}`);
  console.log(`Excluded (Developer Admin)     : ${report.excludedDeveloperAdmin}`);
  console.log(`Excluded (Incomplete/Ambiguous): ${report.excludedIncompleteAmbiguous}`);
  console.log('========================================================================\n');

  if (!isExecuteMode) {
    console.log('>>> DRY RUN MODE ACTIVE: Zero production accounts were modified. <<<');
    console.log('>>> Awaiting explicit administrator authorization before execution. <<<\n');
  } else {
    console.log('>>> LIVE EXECUTION COMPLETE: Production accounts have been updated. <<<\n');
  }

  return report;
}

if (require.main === module) {
  runBackfillAudit().catch(err => {
    console.error('Audit execution error:', err);
    process.exit(1);
  });
}

module.exports = { runBackfillAudit, evaluateAccountEligibility };
