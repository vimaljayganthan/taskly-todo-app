const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');
const HabitStreakService = require('../services/habitStreakService');
const {
  validateStatusTransition,
  toYmdString,
  VALID_STATUSES,
  addDays,
  getLocalYmdInTimezone,
  getLocalTimeInTimezone
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
  const isRemoved = Boolean(
    c.removed ||
    c.status === 'removed' ||
    (c.status === 'cancelled' && (
      c.cancellationReason === 'removed_from_tomorrow' ||
      c.cancellation_reason === 'removed_from_tomorrow' ||
      c.cancellationReason === 'created_for_future' ||
      c.cancellation_reason === 'created_for_future'
    ))
  );
  const status = isRemoved ? 'removed' : (c.status || (c.completed ? 'completed' : 'pending'));
  return {
    id: c.id,
    userId: c.userId || c.user_id,
    user_id: c.userId || c.user_id,
    routineId: c.routineId,
    date: c.date,
    status,
    removed: isRemoved,
    completed: status === 'completed',
    titleOverride: c.titleOverride || c.title_override || null,
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
  async getRoutines(userId, date = null) {
    const data = await ensureDataLoaded();
    const cleanDate = date ? toYmdString(date) : null;
    return (data.routines || [])
      .filter(r => {
        if (r.userId !== userId && r.user_id !== userId) return false;
        if (r.deletedAt) return false;
        if (cleanDate) {
          if (r.startDate && cleanDate < toYmdString(r.startDate)) return false;
          if (r.endDate && cleanDate > toYmdString(r.endDate)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0) || new Date(a.createdAt) - new Date(b.createdAt));
  },

  async addRoutine(userId, { title, orderIndex = 0, startDate = null, endDate = null, recurrence = 'daily', createdAt = null }) {
    const data = await ensureDataLoaded();
    const newRoutine = {
      id: crypto.randomUUID(),
      userId,
      user_id: userId,
      title: title.trim(),
      orderIndex: Number(orderIndex) || 0,
      startDate: startDate ? toYmdString(startDate) : null,
      endDate: endDate ? toYmdString(endDate) : null,
      recurrence: recurrence || (endDate ? 'once' : 'daily'),
      createdAt: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
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
    const idx = data.routines.findIndex(r => r.id === routineId && (r.userId === userId || r.user_id === userId));
    if (idx === -1) return false;

    // Hard delete from routine list so it no longer appears in future days
    // Historical reports remain unaffected because reports store snapshots
    data.routines.splice(idx, 1);

    // Safely clean up future/today completions for this deleted routine to prevent orphaned entries in tomorrow or future days
    const todayStr = HabitStreakService.toYmdString(new Date());
    data.completions = (data.completions || []).filter(c => {
      const isThisRoutine = (c.userId === userId || c.user_id === userId) && (c.routineId === routineId || c.routine_id === routineId);
      if (!isThisRoutine) return true;
      // Preserve historical completions strictly before today for habit tracking integrity
      return c.date < todayStr;
    });

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

    const userRoutines = (data.routines || []).filter(r => {
      if (r.userId !== userId && r.user_id !== userId) return false;
      if (r.deletedAt) return false;
      if (r.startDate && cleanDate < toYmdString(r.startDate)) return false;
      if (r.endDate && cleanDate > toYmdString(r.endDate)) return false;
      return true;
    });
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

    const dayCompletions = (data.completions || []).filter(c => (c.userId === userId || c.user_id === userId) && c.date === cleanDate);

    const userRoutines = (data.routines || []).filter(r => {
      if (r.userId !== userId && r.user_id !== userId) return false;
      if (r.deletedAt) return false;
      if (r.startDate && cleanDate < toYmdString(r.startDate)) return false;
      const comp = dayCompletions.find(c => c.routineId === r.id);
      const isCarried = Boolean(comp?.carriedForward || comp?.carried_forward);
      if (r.endDate && cleanDate > toYmdString(r.endDate) && !isCarried) return false;
      return true;
    });

    const result = [];
    userRoutines.forEach(routine => {
      const comp = dayCompletions.find(c => c.routineId === routine.id);
      // Skip if explicitly removed from this date
      if (comp && (comp.status === 'removed' || comp.removed === true || (comp.status === 'cancelled' && (comp.cancellationReason === 'removed_from_tomorrow' || comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'tomorrow_only')))) {
        return;
      }

      const isCarried = Boolean(comp?.carriedForward || comp?.carried_forward);
      const originalDate = comp?.originalDate || comp?.original_date || null;
      const status = comp ? (comp.status || (comp.completed ? 'completed' : 'pending')) : 'pending';
      const displayTitle = comp?.titleOverride || comp?.title || routine.title;

      result.push({
        routineId: routine.id,
        title: displayTitle,
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

  async assignRoutineToDate(userId, { routineId, date, title, isOneDay = true }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date || HabitStreakService.addDays(toYmdString(new Date()), 1));
    const todayStr = HabitStreakService.toYmdString(new Date());

    let targetRoutineId = routineId;
    let routine = null;

    if (targetRoutineId) {
      routine = data.routines.find(r => r.id === targetRoutineId && (r.userId === userId || r.user_id === userId) && !r.deletedAt);
    }

    if (!routine && title && typeof title === 'string' && title.trim()) {
      const trimmedTitle = title.trim();
      if (trimmedTitle.length > 150) {
        const err = new Error('Routine title must not exceed 150 characters');
        err.statusCode = 400;
        throw err;
      }

      // Check duplicates for this target date (case-insensitive)
      const existingNextDay = await this.getNextDayRoutines(userId, { date: cleanDate });
      if (existingNextDay.routines.some(r => r.title.toLowerCase() === trimmedTitle.toLowerCase())) {
        const err = new Error('A routine with this name already exists for tomorrow');
        err.statusCode = 409;
        throw err;
      }

      routine = {
        id: targetRoutineId || crypto.randomUUID(),
        userId,
        user_id: userId,
        title: trimmedTitle,
        orderIndex: (data.routines || []).filter(r => r.userId === userId || r.user_id === userId).length,
        startDate: cleanDate,
        endDate: isOneDay ? cleanDate : null,
        recurrence: isOneDay ? 'once' : 'daily',
        createdAt: new Date().toISOString(),
        updatedAt: null
      };
      data.routines.push(routine);
      targetRoutineId = routine.id;

      // If target date is in the future, mark routine explicitly removed for today so it never appears in today's active list
      if (cleanDate > todayStr) {
        data.completions.push({
          id: crypto.randomUUID(),
          userId,
          user_id: userId,
          routineId: targetRoutineId,
          date: todayStr,
          status: 'removed',
          removed: true,
          cancellationReason: isOneDay ? 'tomorrow_only' : 'created_for_future',
          completed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } else if (!routine && targetRoutineId) {
      const err = new Error('Routine not found or deleted');
      err.statusCode = 404;
      throw err;
    } else if (!routine) {
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

  async updateOccurrenceTitle(userId, { routineId, date, title, applyToFuture = false }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);
    const todayStr = HabitStreakService.toYmdString(new Date());

    if (!title || typeof title !== 'string' || !title.trim()) {
      const err = new Error('Routine title cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 150) {
      const err = new Error('Routine title must not exceed 150 characters');
      err.statusCode = 400;
      throw err;
    }

    const routine = data.routines.find(r => r.id === routineId && (r.userId === userId || r.user_id === userId) && !r.deletedAt);
    if (!routine) {
      const err = new Error('Routine not found or access denied');
      err.statusCode = 404;
      throw err;
    }

    // Duplicate check for target date (case-insensitive among other routines)
    const existingNextDay = await this.getNextDayRoutines(userId, { date: cleanDate });
    if (existingNextDay.routines.some(r => r.routineId !== routineId && r.title.toLowerCase() === trimmedTitle.toLowerCase())) {
      const err = new Error('A routine with this name already exists for tomorrow');
      err.statusCode = 409;
      throw err;
    }

    const oldTitle = routine.title;

    // If applyToFuture is true: update routine definition, but preserve today's title by setting titleOverride on today
    if (applyToFuture) {
      if (cleanDate > todayStr) {
        let todayComp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === todayStr);
        if (todayComp) {
          if (!todayComp.titleOverride) todayComp.titleOverride = oldTitle;
          if (todayComp.cancellationReason === 'tomorrow_only') {
            todayComp.cancellationReason = 'created_for_future';
          }
        } else {
          data.completions.push({
            id: crypto.randomUUID(),
            userId,
            user_id: userId,
            routineId,
            date: todayStr,
            titleOverride: oldTitle,
            status: 'pending',
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      }
      // Clear any stale titleOverride on future dates (date >= cleanDate) so future occurrences reflect the updated master title
      (data.completions || []).forEach(c => {
        if ((c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date >= cleanDate) {
          c.titleOverride = null;
          c.updatedAt = new Date().toISOString();
        }
      });
      routine.title = trimmedTitle;
      routine.endDate = null; // Clears one-day constraint so it recurs daily into the future indefinitely!
      routine.recurrence = 'daily';
      if (routine.startDate && routine.startDate > cleanDate) {
        routine.startDate = cleanDate;
      }
      routine.updatedAt = new Date().toISOString();
    }

    // Occurrence-level override for cleanDate
    let comp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && c.routineId === routineId && c.date === cleanDate);
    if (comp) {
      comp.titleOverride = trimmedTitle;
      comp.updatedAt = new Date().toISOString();
    } else {
      comp = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        routineId,
        date: cleanDate,
        titleOverride: trimmedTitle,
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
      success: true,
      routineId,
      date: cleanDate,
      title: trimmedTitle,
      applyToFuture: Boolean(applyToFuture),
      occurrence: formatCompletion(comp),
      routine
    };
  },

  async removeOccurrenceFromDate(userId, { routineId, date }) {
    const data = await ensureDataLoaded();
    const cleanDate = toYmdString(date);

    // Check if parent routine exists
    const routine = (data.routines || []).find(r => (r.id === routineId) && (r.userId === userId || r.user_id === userId) && !r.deletedAt);

    let comp = data.completions.find(c => (c.userId === userId || c.user_id === userId) && (c.routineId === routineId || c.routine_id === routineId) && c.date === cleanDate);
    if (comp) {
      if (!routine) {
        // If parent routine was already deleted, remove the orphaned completion record safely
        data.completions = data.completions.filter(c => c !== comp);
      } else {
        comp.status = 'removed';
        comp.removed = true;
        comp.cancellationReason = 'removed_from_tomorrow';
        comp.updatedAt = new Date().toISOString();
      }
    } else {
      // Only insert a cancellation record if the parent routine actually exists
      if (routine) {
        comp = {
          id: crypto.randomUUID(),
          userId,
          user_id: userId,
          routineId,
          date: cleanDate,
          status: 'removed',
          removed: true,
          cancellationReason: 'removed_from_tomorrow',
          completed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        data.completions.push(comp);
      }
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

  async saveReport(userId, reportData, { overwrite = true } = {}) {
    const data = await ensureDataLoaded();
    const date = toYmdString(reportData.date);
    const existingIndex = data.reports.findIndex(r => (r.userId === userId || r.user_id === userId) && r.date === date);

    if (existingIndex !== -1 && overwrite === false) {
      return data.reports[existingIndex];
    }

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

    const completedCount = Array.isArray(completedRoutines) && completedRoutines.length > 0
      ? completedRoutines.length
      : (typeof reportData.completedCount === 'number' ? reportData.completedCount : completedRoutines.length);
    const incompleteCount = Array.isArray(incompleteRoutines) && incompleteRoutines.length > 0
      ? incompleteRoutines.length
      : (typeof reportData.incompleteCount === 'number' ? reportData.incompleteCount : incompleteRoutines.length);
    const postponedCount = postponedRoutines.length;
    const cancelledCount = cancelledRoutines.length;

    const totalRoutines = typeof reportData.totalRoutines === 'number'
      ? reportData.totalRoutines
      : (completedCount + incompleteCount + cancelledCount);

    const eligibleCount = totalRoutines - cancelledCount;
    const completionRate = typeof reportData.completionRate === 'number'
      ? reportData.completionRate
      : (eligibleCount > 0
          ? Math.round((completedCount / eligibleCount) * 100)
          : (totalRoutines > 0 ? Math.round((completedCount / totalRoutines) * 100) : 0));

    const isStreakQualified = (eligibleCount > 0) && (completionRate >= 80);

    let status = reportData.status || 'Not Started';
    let statusBadge = reportData.statusBadge || (totalRoutines === 0 ? 'No Routines' : 'Not Started');
    if (totalRoutines === 0) {
      status = 'Not Started';
      statusBadge = 'No Routines';
    } else if (eligibleCount > 0 && completedCount === eligibleCount) {
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
    } else {
      status = 'Not Started';
      statusBadge = 'Not Started';
    }

    let closingStatement = reportData.closingStatement;
    if (!closingStatement) {
      if (totalRoutines === 0) {
        closingStatement = 'No routines scheduled for this date.';
      } else if (eligibleCount === 0 && cancelledCount > 0) {
        closingStatement = 'All scheduled routines were excused/cancelled for this date.';
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
      updatedAt: new Date().toISOString(),
      isReconciled: Boolean(reportData.isReconciled)
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
    const deletedReport = data.reports.splice(idx, 1)[0];
    if (!data.deletedReportDates) data.deletedReportDates = {};
    if (!data.deletedReportDates[userId]) data.deletedReportDates[userId] = [];
    if (deletedReport?.date && !data.deletedReportDates[userId].includes(deletedReport.date)) {
      data.deletedReportDates[userId].push(deletedReport.date);
    }
    await persistData();
    return true;
  },

  // --- Missed-Day Reconciliation & Zero-Gap Generation ---

  async reconcileDailyReports(userId, options = {}) {
    const data = await ensureDataLoaded();
    const userSettings = (data.settings && data.settings[userId]) || {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00',
      timezone: 'UTC'
    };

    const tz = options.timezone || userSettings.timezone || 'UTC';
    const now = options.now instanceof Date ? options.now : (options.now ? new Date(options.now) : new Date());
    const currentLocalDate = options.localDate || getLocalYmdInTimezone(now, tz);
    const currentLocalTime = options.currentTime || getLocalTimeInTimezone(now, tz);
    const targetReportTime = options.reportTime || userSettings.dailySummaryTime || '22:00';
    const maxLookbackDays = typeof options.maxLookbackDays === 'number' ? options.maxLookbackDays : 30;

    const userRoutines = (data.routines || []).filter(r => r.userId === userId || r.user_id === userId);
    const userCompletions = (data.completions || []).filter(c => c.userId === userId || c.user_id === userId);
    const existingReports = (data.reports || []).filter(r => r.userId === userId || r.user_id === userId);
    const existingDateSet = new Set(existingReports.map(r => r.date));
    const deletedDates = new Set((data.deletedReportDates && data.deletedReportDates[userId]) || []);

    // Determine earliest relevant start date
    let earliestYmd = options.startDate || currentLocalDate;
    if (!options.startDate) {
      if (userRoutines.length > 0) {
        const routineDates = userRoutines.map(r => (r.createdAt || r.created_at || '').slice(0, 10)).filter(Boolean);
        if (routineDates.length > 0) {
          routineDates.sort();
          if (routineDates[0] < earliestYmd) earliestYmd = routineDates[0];
        }
      }
      if (existingReports.length > 0) {
        const reportDates = existingReports.map(r => r.date).filter(Boolean);
        reportDates.sort();
        if (reportDates[0] < earliestYmd) earliestYmd = reportDates[0];
      }
    }

    // Clamp lookback to avoid excessive loops
    const minAllowedDate = addDays(currentLocalDate, -maxLookbackDays);
    if (earliestYmd < minAllowedDate) {
      earliestYmd = minAllowedDate;
    }

    const maxEndDate = options.endDate || currentLocalDate;
    const generated = [];
    let cursor = earliestYmd;

    while (cursor <= maxEndDate) {
      // Do not recreate user-deleted reports
      if (!deletedDates.has(cursor)) {
        // If report does not already exist
        if (!existingDateSet.has(cursor)) {
          const isToday = (cursor === currentLocalDate);
          // Past dates are always closed and should have reports
          // Today is only finalized if current local time >= target report time, or forceToday is true
          const shouldGenerate = !isToday || Boolean(options.forceToday) || (currentLocalTime >= targetReportTime);

          if (shouldGenerate) {
            // Find routines that actually existed on this historical date (preserve historical accuracy)
            const applicableRoutines = userRoutines.filter(r => {
              const comp = userCompletions.find(c => (c.routineId === r.id || c.routine_id === r.id) && c.date === cursor);
              const hasActivity = comp && (comp.completed || comp.status);
              if (!hasActivity) {
                const createdYmd = (r.createdAt || r.created_at || '').slice(0, 10);
                if (createdYmd && createdYmd > cursor) return false;
              }
              if (r.startDate && r.startDate > cursor) return false;
              if (r.endDate && r.endDate < cursor) return false;
              return true;
            });

            const completedTitles = [];
            const incompleteTitles = [];

            applicableRoutines.forEach(r => {
              const comp = userCompletions.find(c => (c.routineId === r.id || c.routine_id === r.id) && c.date === cursor);
              if (comp && comp.completed) {
                completedTitles.push(r.title);
              } else {
                incompleteTitles.push(r.title);
              }
            });

            const totalCount = applicableRoutines.length;
            const completedCount = completedTitles.length;
            const incompleteCount = incompleteTitles.length;
            const rate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            let status = 'Not Started';
            let statusBadge = totalCount === 0 ? 'No Routines' : 'Not Started';
            if (totalCount === 0) {
              status = 'Not Started';
              statusBadge = 'No Routines';
            } else if (completedCount === totalCount) {
              status = 'Fully Completed';
              statusBadge = 'Exceptional';
            } else if (rate >= 80) {
              status = 'Partially Completed';
              statusBadge = 'Great Job';
            } else if (rate >= 50) {
              status = 'Partially Completed';
              statusBadge = 'Good Progress';
            } else if (completedCount > 0) {
              status = 'Partially Completed';
              statusBadge = 'Needs Focus';
            } else {
              status = 'Not Started';
              statusBadge = 'Not Started';
            }

            const newReport = await this.saveReport(userId, {
              date: cursor,
              totalRoutines: totalCount,
              completedRoutines: completedTitles,
              completedCount,
              incompleteRoutines: incompleteTitles,
              incompleteCount,
              completionRate: rate,
              status,
              statusBadge,
              closingStatement: totalCount === 0 ? 'No routines scheduled for this date.' : undefined,
              carryForwardDecision: 'pending',
              isReconciled: true
            }, { overwrite: false });

            generated.push(newReport);
            existingDateSet.add(cursor);
          }
        }
      }
      cursor = addDays(cursor, 1);
    }

    return {
      userId,
      reconciledCount: generated.length,
      reconciledDatesCount: generated.length,
      generatedReports: generated,
      reports: generated
    };
  },

  // --- Settings ---

  async getSettings(userId) {
    const data = await ensureDataLoaded();
    return (data.settings && data.settings[userId]) || {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00',
      timezone: 'UTC',
      streakThreshold: 80,
      streakResetAt: null
    };
  },

  async saveSettings(userId, settings) {
    const data = await ensureDataLoaded();
    if (!data.settings) data.settings = {};
    const existing = data.settings[userId] || {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00',
      timezone: 'UTC',
      streakThreshold: 80,
      streakResetAt: null
    };

    data.settings[userId] = {
      dailySummaryEnabled: typeof settings.dailySummaryEnabled === 'boolean'
        ? settings.dailySummaryEnabled
        : existing.dailySummaryEnabled,
      dailySummaryTime: typeof settings.dailySummaryTime === 'string' && settings.dailySummaryTime.trim()
        ? settings.dailySummaryTime.trim()
        : existing.dailySummaryTime,
      timezone: typeof settings.timezone === 'string' && settings.timezone.trim()
        ? settings.timezone.trim()
        : (existing.timezone || 'UTC'),
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

  async getAllDataForAudit() {
    const data = await ensureDataLoaded();
    return data;
  },

  // Test helper
  __resetForTests() {
    inMemoryData = {
      routines: [],
      completions: [],
      reports: [],
      settings: {},
      deletedReportDates: {}
    };
  },
  __clearCache() {
    inMemoryData = null;
  }
};

module.exports = SmartListStore;
