const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');
const HabitStreakService = require('../services/habitStreakService');
const {
  validateStatusTransition,
  toYmdString,
  VALID_STATUSES,
  addDays
} = HabitStreakService;

const DATA_DIR = path.join(__dirname, '..', 'data');
function getDataFile() {
  return process.env.SMART_LISTS_DATA_FILE || path.join(DATA_DIR, 'smart_lists.json');
}

let inMemoryData = null;

async function ensureDataLoaded() {
  if (inMemoryData !== null) return inMemoryData;

  const filePath = getDataFile();
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    inMemoryData = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      inMemoryData = {
        routines: [],
        completions: [],
        reports: [],
        settings: {}
      };
      await persistData();
    } else {
      console.warn('[SmartListStore] Read error, starting empty:', err.message);
      inMemoryData = { routines: [], completions: [], reports: [], settings: {} };
    }
  }
  return inMemoryData;
}

async function persistData() {
  if (!inMemoryData) return;
  const filePath = getDataFile();
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(inMemoryData, null, 2), 'utf8');
  } catch (err) {
    console.error('[SmartListStore] Persist error:', err.message);
  }
}

function formatCompletion(c) {
  if (!c) return null;
  const status = c.status || (c.completed ? 'completed' : 'pending');
  return {
    id: c.id,
    userId: c.userId || c.user_id,
    user_id: c.userId || c.user_id,
    routineId: c.routineId,
    date: c.date,
    status,
    completed: status === 'completed',
    postponedTo: c.postponedTo || c.postponed_to || null,
    cancellationReason: c.cancellationReason || c.cancellation_reason || null,
    completedAt: c.completedAt || c.completed_at || null,
    carriedForward: Boolean(c.carriedForward || c.carried_forward),
    originalDate: c.originalDate || c.original_date || null,
    createdAt: c.createdAt || c.created_at,
    updatedAt: c.updatedAt || c.updated_at || null
  };
}

const SmartListStore = {
  async getRoutines(userId) {
    const data = await ensureDataLoaded();
    return (data.routines || [])
      .filter(r => r.userId === userId && !r.deletedAt)
      .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0) || new Date(a.createdAt) - new Date(b.createdAt));
  },

  async addRoutine(userId, { title, orderIndex = 0 }) {
    const data = await ensureDataLoaded();
    const newRoutine = {
      id: crypto.randomUUID(),
      userId,
      user_id: userId,
      title: title.trim(),
      orderIndex: Number(orderIndex) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      deletedAt: null
    };
    data.routines.push(newRoutine);
    await persistData();
    return newRoutine;
  },

  async updateRoutine(userId, routineId, updates) {
    const data = await ensureDataLoaded();
    const routine = data.routines.find(r => r.id === routineId && r.userId === userId && !r.deletedAt);
    if (!routine) return null;

    if (typeof updates.title === 'string' && updates.title.trim()) {
      routine.title = updates.title.trim();
    }
    if (typeof updates.orderIndex === 'number') {
      routine.orderIndex = updates.orderIndex;
    }
    routine.updatedAt = new Date().toISOString();
    await persistData();
    return routine;
  },

  async deleteRoutine(userId, routineId) {
    const data = await ensureDataLoaded();
    const idx = data.routines.findIndex(r => r.id === routineId && r.userId === userId);
    if (idx === -1) return false;

    // Hard delete from routine list so it no longer appears in future days
    // Historical reports remain unaffected because reports store snapshots
    data.routines.splice(idx, 1);
    await persistData();
    return true;
  },

  // --- Completions & 4-State Routine Operations ---

  async getCompletions(userId, date) {
    const data = await ensureDataLoaded();
    const cleanDate = date ? toYmdString(date) : null;
    return (data.completions || [])
      .filter(c => (c.userId === userId || c.user_id === userId) && (!cleanDate || c.date === cleanDate))
      .map(formatCompletion);
  },

  async getAllCompletions(userId) {
    const data = await ensureDataLoaded();
    return (data.completions || [])
      .filter(c => c.userId === userId || c.user_id === userId)
      .map(formatCompletion);
  },

  async getRoutineOccurrences(userId, routineId) {
    const data = await ensureDataLoaded();
    return (data.completions || [])
      .filter(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(formatCompletion);
  },

  async setRoutineStatus(userId, { routineId, date, status, postponedTo = null, cancellationReason = null, completedAt = null, updatedAt = null }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);

    // Validate that routine exists and belongs to user
    const routine = data.routines.find(r => r.id === routineId && (r.userId === userId || r.user_id === userId));
    if (!routine) {
      const err = new Error('Routine not found or access denied');
      err.statusCode = 404;
      throw err;
    }

    let record = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === cleanDate);
    const currentStatus = record ? (record.status || (record.completed ? 'completed' : 'pending')) : 'pending';

    const validation = validateStatusTransition(currentStatus, status, {
      date: cleanDate,
      postponedTo,
      cancellationReason
    });

    const normalizedStatus = validation.normalizedStatus;
    const cleanPostponedTo = validation.postponedTo;
    const cleanReason = validation.cancellationReason;

    const resolvedCompletedAt = normalizedStatus === 'completed' ? (completedAt || new Date().toISOString()) : null;
    const resolvedUpdatedAt = updatedAt || new Date().toISOString();

    if (record) {
      record.status = normalizedStatus;
      record.completed = (normalizedStatus === 'completed');
      record.completedAt = resolvedCompletedAt;
      record.postponedTo = cleanPostponedTo;
      record.cancellationReason = cleanReason;
      record.updatedAt = resolvedUpdatedAt;
    } else {
      record = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        routineId,
        date: cleanDate,
        status: normalizedStatus,
        completed: (normalizedStatus === 'completed'),
        completedAt: resolvedCompletedAt,
        postponedTo: cleanPostponedTo,
        cancellationReason: cleanReason,
        carriedForward: false,
        createdAt: resolvedUpdatedAt,
        updatedAt: resolvedUpdatedAt
      };
      data.completions.push(record);
    }

    // Atomic target occurrence scheduling for postponement
    let targetOccurrence = null;
    if (normalizedStatus === 'postponed' && cleanPostponedTo) {
      let targetRecord = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === cleanPostponedTo);
      if (targetRecord) {
        targetRecord.carriedForward = true;
        targetRecord.updatedAt = new Date().toISOString();
        targetOccurrence = targetRecord;
      } else {
        targetRecord = {
          id: crypto.randomUUID(),
          userId,
          user_id: userId,
          routineId,
          date: cleanPostponedTo,
          status: 'pending',
          completed: false,
          completedAt: null,
          postponedTo: null,

          cancellationReason: null,
          carriedForward: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        data.completions.push(targetRecord);
        targetOccurrence = targetRecord;
      }
    }

    await persistData();
    return {
      record: formatCompletion(record),
      targetRecord: targetOccurrence ? formatCompletion(targetOccurrence) : null
    };
  },

  async postponeRoutine(userId, routineId, date, postponedTo) {
    const res = await this.setRoutineStatus(userId, {
      routineId,
      date,
      status: 'postponed',
      postponedTo
    });
    return res;
  },

  async cancelRoutine(userId, routineId, date, cancellationReason = null) {
    const res = await this.setRoutineStatus(userId, {
      routineId,
      date,
      status: 'cancelled',
      cancellationReason
    });
    return res.record;
  },

  async undoCancelRoutine(userId, routineId, date) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);

    let comp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === cleanDate);
    if (!comp) {
      const err = new Error('Routine completion record not found');
      err.statusCode = 404;
      throw err;
    }

    comp.status = 'pending';
    comp.completed = false;
    comp.completedAt = null;
    comp.cancellationReason = null;
    comp.updatedAt = new Date().toISOString();

    await persistData();
    const formatted = formatCompletion(comp);
    return Object.assign({ success: true, record: formatted }, formatted);
  },

  // --- Carry-Forward Operation ---

  async carryForward(userId, { date, decision }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);
    const nextDayStr = HabitStreakService.addDays(cleanDate, 1);

    if (!['yes', 'no'].includes(decision)) {
      const err = new Error('Decision must be either "yes" or "no"');
      err.statusCode = 400;
      throw err;
    }

    const userRoutines = (data.routines || []).filter(r => (r.userId === userId || r.user_id === userId) && !r.deletedAt);
    const existingCompletions = (data.completions || []).filter(c => (c.userId === userId || c.user_id === userId));

    const carriedRoutines = [];
    const postponedTitles = [];

    if (decision === 'yes') {
      userRoutines.forEach(routine => {
        let comp = existingCompletions.find(c => c.routineId === routine.id && c.date === cleanDate);
        const status = comp ? (comp.status || (comp.completed ? 'completed' : 'pending')) : 'pending';

        // Only incomplete routines (not completed and not cancelled)
        if (status !== 'completed' && status !== 'cancelled') {
          // 1. Mark original occurrence as postponed
          if (comp) {
            comp.status = 'postponed';
            comp.completed = false;
            comp.postponedTo = nextDayStr;
            comp.updatedAt = new Date().toISOString();
          } else {
            comp = {
              id: crypto.randomUUID(),
              userId,
              user_id: userId,
              routineId: routine.id,
              date: cleanDate,
              status: 'postponed',
              completed: false,
              completedAt: null,
              postponedTo: nextDayStr,
              cancellationReason: null,
              carriedForward: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            data.completions.push(comp);
          }
          postponedTitles.push(routine.title);

          // 2. Schedule next-day occurrence as pending (prevent duplicate)
          let nextComp = existingCompletions.find(c => c.routineId === routine.id && c.date === nextDayStr);
          if (!nextComp) {
            nextComp = {
              id: crypto.randomUUID(),
              userId,
              user_id: userId,
              routineId: routine.id,
              date: nextDayStr,
              status: 'pending',
              completed: false,
              completedAt: null,
              postponedTo: null,
              cancellationReason: null,
              carriedForward: true,
              originalDate: cleanDate,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            data.completions.push(nextComp);
          } else if (nextComp.status !== 'completed') {
            nextComp.status = 'pending';
            nextComp.completed = false;
            nextComp.carriedForward = true;
            nextComp.originalDate = cleanDate;
            nextComp.updatedAt = new Date().toISOString();
          }

          carriedRoutines.push({
            routineId: routine.id,
            title: routine.title,
            nextDate: nextDayStr
          });
        }
      });
    }

    // Update report
    let report = data.reports.find(r => (r.userId === userId || r.user_id === userId) && r.date === cleanDate);
    const dayStats = HabitStreakService.calculateDayStatistics({
      routines: userRoutines,
      completions: data.completions.filter(c => (c.userId === userId || c.user_id === userId) && c.date === cleanDate),
      date: cleanDate
    });

    const completedTitles = dayStats.routines.filter(r => r.isCompleted).map(r => r.title);
    const incompleteTitles = dayStats.routines.filter(r => r.isPending).map(r => r.title);
    const cancelledTitles = dayStats.routines.filter(r => r.isCancelled).map(r => r.title);

    let closingStatement = '';
    if (decision === 'yes') {
      closingStatement = carriedRoutines.length > 0
        ? `${carriedRoutines.length} incomplete routine${carriedRoutines.length === 1 ? '' : 's'} were carried forward to tomorrow (${nextDayStr}).`
        : 'All routines were already completed or excused; no routines carried forward.';
    } else {
      closingStatement = "Today's checklist was closed without carrying forward routines.";
    }

    if (report) {
      report.carryForwardDecision = decision;
      report.completedCount = dayStats.completedCount;
      report.incompleteCount = dayStats.pendingCount;
      report.postponedCount = dayStats.postponedCount;
      report.cancelledCount = dayStats.cancelledCount;
      report.eligibleCount = dayStats.eligibleCount;
      report.completionRate = dayStats.completionRate;
      report.completedRoutines = completedTitles;
      report.incompleteRoutines = incompleteTitles;
      report.postponedRoutines = postponedTitles;
      report.cancelledRoutines = cancelledTitles;
      report.closingStatement = closingStatement;
      report.updatedAt = new Date().toISOString();
    } else {
      report = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        date: cleanDate,
        totalRoutines: dayStats.totalCount,
        eligibleCount: dayStats.eligibleCount,
        completedCount: dayStats.completedCount,
        incompleteCount: dayStats.pendingCount,
        postponedCount: dayStats.postponedCount,
        cancelledCount: dayStats.cancelledCount,
        completionRate: dayStats.completionRate,
        isStreakQualified: dayStats.isQualified,
        status: dayStats.isQualified ? 'Partially Completed' : 'Needs Focus',
        statusBadge: dayStats.isQualified ? 'Great Job' : 'Needs Focus',
        closingStatement,
        completedRoutines: completedTitles,
        incompleteRoutines: incompleteTitles,
        postponedRoutines: postponedTitles,
        cancelledRoutines: cancelledTitles,
        carryForwardDecision: decision,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.reports.push(report);
    }

    await persistData();

    return {
      success: true,
      date: cleanDate,
      nextDayStr,
      nextDay: nextDayStr,
      decision,
      carriedCount: carriedRoutines.length,
      carriedRoutines,
      postponedRoutines: postponedTitles,
      report
    };
  },

  // --- Next-Day Routines Management ---

  async getNextDayRoutines(userId, { date } = {}) {
    const data = await ensureDataLoaded();
    const cleanDate = date ? toYmdString(date) : HabitStreakService.addDays(toYmdString(new Date()), 1);

    const userRoutines = (data.routines || []).filter(r => (r.userId === userId || r.user_id === userId) && !r.deletedAt);
    const dayCompletions = (data.completions || []).filter(c => (c.userId === userId || c.user_id === userId) && c.date === cleanDate);

    const result = [];
    userRoutines.forEach(routine => {
      const comp = dayCompletions.find(c => c.routineId === routine.id);
      // Skip if explicitly removed from this date
      if (comp && (comp.status === 'removed' || comp.removed === true)) {
        return;
      }

      const isCarried = Boolean(comp?.carriedForward || comp?.carried_forward);
      const originalDate = comp?.originalDate || comp?.original_date || null;
      const status = comp ? (comp.status || (comp.completed ? 'completed' : 'pending')) : 'pending';

      result.push({
        routineId: routine.id,
        title: routine.title,
        orderIndex: routine.orderIndex || 0,
        date: cleanDate,
        status,
        completed: status === 'completed',
        carriedForward: isCarried,
        originalDate,
        source: isCarried ? 'carried_forward' : 'scheduled'
      });
    });

    return {
      date: cleanDate,
      totalCount: result.length,
      routines: result
    };
  },

  async assignRoutineToDate(userId, { routineId, date, title }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date || HabitStreakService.addDays(toYmdString(new Date()), 1));

    let targetRoutineId = routineId;
    let routine = null;

    if (targetRoutineId) {
      routine = data.routines.find(r => r.id === targetRoutineId && (r.userId === userId || r.user_id === userId) && !r.deletedAt);
      if (!routine) {
        const err = new Error('Routine not found or deleted');
        err.statusCode = 404;
        throw err;
      }
    } else if (title && typeof title === 'string' && title.trim()) {
      routine = await this.addRoutine(userId, { title: title.trim() });
      targetRoutineId = routine.id;
    } else {
      const err = new Error('Either routineId or title is required');
      err.statusCode = 400;
      throw err;
    }

    let comp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === targetRoutineId && c.date === cleanDate);
    if (comp) {
      comp.status = 'pending';
      comp.completed = false;
      comp.removed = false;
      comp.updatedAt = new Date().toISOString();
    } else {
      comp = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        routineId: targetRoutineId,
        date: cleanDate,
        status: 'pending',
        completed: false,
        completedAt: null,
        postponedTo: null,
        cancellationReason: null,
        carriedForward: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.completions.push(comp);
    }

    await persistData();
    return {
      routine,
      occurrence: formatCompletion(comp)
    };
  },

  async removeOccurrenceFromDate(userId, { routineId, date }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);

    let comp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === cleanDate);
    if (comp) {
      comp.status = 'removed';
      comp.removed = true;
      comp.updatedAt = new Date().toISOString();
    } else {
      comp = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        routineId,
        date: cleanDate,
        status: 'removed',
        removed: true,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.completions.push(comp);
    }

    await persistData();
    return { success: true, routineId, date: cleanDate };
  },

  // --- Streak Reset Operation ---

  async resetStreak(userId, { resetAt } = {}) {
    const data = await ensureDataLoaded();
    if (!data.settings) data.settings = {};
    if (!data.settings[userId]) {
      data.settings[userId] = { dailySummaryEnabled: true, dailySummaryTime: '22:00', streakThreshold: 80, streakResetAt: null };
    }

    const resetTimestamp = resetAt || new Date().toISOString();
    data.settings[userId].streakResetAt = resetTimestamp;
    data.settings[userId].updatedAt = new Date().toISOString();

    await persistData();
    return {
      success: true,
      resetAt: resetTimestamp,
      streaks: { currentStreak: 0, longestStreak: 0 }
    };
  },

  // Backward compatibility wrapper for existing tests/clients
  async setCompletion(userId, { routineId, date, completed, carriedForward = false, status, postponedTo, cancellationReason }) {
    let targetStatus = status;
    if (!targetStatus) {
      targetStatus = completed ? 'completed' : 'pending';
    }

    const { record } = await this.setRoutineStatus(userId, {
      routineId,
      date,
      status: targetStatus,
      postponedTo,
      cancellationReason
    });

    if (typeof carriedForward === 'boolean') {
      const data = await ensureDataLoaded();
      const rec = data.completions.find(c => c.id === record.id);
      if (rec) {
        rec.carriedForward = carriedForward;
        await persistData();
        record.carriedForward = carriedForward;
      }
    }

    return record;
  },

  // --- Daily Summary Reports ---

  async getReports(userId) {
    const data = await ensureDataLoaded();
    return (data.reports || [])
      .filter(r => r.userId === userId || r.user_id === userId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  async getReport(userId, date) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);
    return (data.reports || []).find(r => (r.userId === userId || r.user_id === userId) && r.date === cleanDate) || null;
  },

  async saveReport(userId, reportData) {
    const data = await ensureDataLoaded();
    const date = toYmdString(reportData.date);
    const existingIndex = data.reports.findIndex(r => (r.userId === userId || r.user_id === userId) && r.date === date);

    let completedRoutines = reportData.completedRoutines;
    if (typeof completedRoutines === 'string') {
      try { completedRoutines = JSON.parse(completedRoutines); } catch (_) { completedRoutines = []; }
    }
    if (!Array.isArray(completedRoutines)) {
      completedRoutines = Array.isArray(reportData.completedList)
        ? reportData.completedList
        : (Array.isArray(reportData.completed_routines) ? reportData.completed_routines : []);
    }
    completedRoutines = completedRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    let incompleteRoutines = reportData.incompleteRoutines;
    if (typeof incompleteRoutines === 'string') {
      try { incompleteRoutines = JSON.parse(incompleteRoutines); } catch (_) { incompleteRoutines = []; }
    }
    if (!Array.isArray(incompleteRoutines)) {
      incompleteRoutines = Array.isArray(reportData.incompleteList)
        ? reportData.incompleteList
        : (Array.isArray(reportData.incomplete_routines) ? reportData.incomplete_routines : []);
    }
    incompleteRoutines = incompleteRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    let postponedRoutines = Array.isArray(reportData.postponedRoutines)
      ? reportData.postponedRoutines
      : (Array.isArray(reportData.postponed_routines) ? reportData.postponed_routines : []);
    postponedRoutines = postponedRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    let cancelledRoutines = Array.isArray(reportData.cancelledRoutines)
      ? reportData.cancelledRoutines
      : (Array.isArray(reportData.cancelled_routines) ? reportData.cancelled_routines : []);
    cancelledRoutines = cancelledRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    const completedCount = completedRoutines.length;
    const incompleteCount = incompleteRoutines.length;
    const postponedCount = postponedRoutines.length;
    const cancelledCount = cancelledRoutines.length;

    const totalRoutines = typeof reportData.totalRoutines === 'number'
      ? reportData.totalRoutines
      : (completedCount + incompleteCount + cancelledCount);

    const eligibleCount = totalRoutines - cancelledCount;
    const completionRate = eligibleCount > 0
      ? Math.round((completedCount / eligibleCount) * 100)
      : (totalRoutines > 0 ? Math.round((completedCount / totalRoutines) * 100) : 0);

    const isStreakQualified = (eligibleCount > 0) && (completionRate >= 80);

    let status = reportData.status || 'Not Started';
    let statusBadge = reportData.statusBadge || 'Not Started';
    if (eligibleCount > 0 && completedCount === eligibleCount) {
      status = 'Fully Completed';
      statusBadge = 'Exceptional';
    } else if (completionRate >= 80) {
      status = 'Partially Completed';
      statusBadge = 'Great Job';
    } else if (completionRate >= 50) {
      status = 'Partially Completed';
      statusBadge = 'Good Progress';
    } else if (completedCount > 0) {
      status = 'Partially Completed';
      statusBadge = 'Needs Focus';
    }

    let closingStatement = reportData.closingStatement;
    if (!closingStatement) {
      if (eligibleCount === 0 && cancelledCount > 0) {
        closingStatement = 'All scheduled routines were excused/cancelled for this date.';
      } else if (totalRoutines === 0) {
        closingStatement = 'No routines scheduled for this date.';
      } else if (completedCount === eligibleCount) {
        closingStatement = 'Outstanding work! You completed 100% of your eligible routines today. All objectives achieved!';
      } else if (completionRate >= 80) {
        closingStatement = `Great job! You achieved ${completionRate}% routine completion today. Keep up the strong consistency tomorrow!`;
      } else if (completionRate >= 50) {
        closingStatement = `Good progress! You reached ${completionRate}% routine completion today. Stay focused to close out the remaining routines!`;
      } else if (completedCount > 0) {
        closingStatement = `Some routines completed today (${completionRate}%). Keep pushing forward tomorrow to build momentum!`;
      } else {
        closingStatement = 'No routines were completed today. Tomorrow is a fresh opportunity to start strong!';
      }
    }

    const report = {
      id: reportData.id || crypto.randomUUID(),
      userId,
      user_id: userId,
      date,
      totalRoutines,
      eligibleCount,
      completedCount,
      incompleteCount,
      postponedCount,
      cancelledCount,
      completionRate,
      isStreakQualified,
      status,
      statusBadge,
      closingStatement,
      completedRoutines,
      incompleteRoutines,
      postponedRoutines,
      cancelledRoutines,
      completedList: completedRoutines,
      incompleteList: incompleteRoutines,
      routinesSnapshot: Array.isArray(reportData.routinesSnapshot) ? reportData.routinesSnapshot : [],
      carryForwardDecision: reportData.carryForwardDecision || 'pending',
      createdAt: existingIndex !== -1 ? data.reports[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      data.reports[existingIndex] = report;
    } else {
      data.reports.push(report);
    }

    await persistData();
    return report;
  },

  async deleteReport(userId, reportId) {
    const data = await ensureDataLoaded();
    const idx = data.reports.findIndex(r => (r.id === reportId || r.date === reportId) && (r.userId === userId || r.user_id === userId));
    if (idx === -1) return false;
    data.reports.splice(idx, 1);
    await persistData();
    return true;
  },

  // --- Settings ---

  async getSettings(userId) {
    const data = await ensureDataLoaded();
    return (data.settings && data.settings[userId]) || {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00',
      streakThreshold: 80,
      streakResetAt: null
    };
  },

  async saveSettings(userId, settings) {
    const data = await ensureDataLoaded();
    if (!data.settings) data.settings = {};
    const existing = data.settings[userId] || { dailySummaryEnabled: true, dailySummaryTime: '22:00', streakThreshold: 80, streakResetAt: null };

    data.settings[userId] = {
      dailySummaryEnabled: typeof settings.dailySummaryEnabled === 'boolean'
        ? settings.dailySummaryEnabled
        : existing.dailySummaryEnabled,
      dailySummaryTime: typeof settings.dailySummaryTime === 'string' && settings.dailySummaryTime.trim()
        ? settings.dailySummaryTime.trim()
        : existing.dailySummaryTime,
      streakThreshold: typeof settings.streakThreshold === 'number' && settings.streakThreshold >= 1 && settings.streakThreshold <= 100
        ? settings.streakThreshold
        : (existing.streakThreshold || 80),
      streakResetAt: settings.streakResetAt !== undefined
        ? settings.streakResetAt
        : (existing.streakResetAt || null),
      updatedAt: new Date().toISOString()
    };

    await persistData();
    return data.settings[userId];
  },

  // Test helper
  __resetForTests() {
    inMemoryData = {
      routines: [],
      completions: [],
      reports: [],
      settings: {}
    };
  }
};

module.exports = SmartListStore;
