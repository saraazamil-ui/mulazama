import { DomainError } from '../core/types';
export const FORECAST_REFUSAL = 'لا تتوفر بيانات كافية لتقدير التقدم المتوقع بصورة موثوقة';
export interface ForecastInput {
  calendarDays: number; activeDays: number; acquiredUnitsWithKnownTime: number;
  maintenanceTimeMeasured: boolean; replayPending: boolean; recoveryActive: boolean;
  capacityFeasible: boolean; planStable: boolean; declaredComplete: boolean;
}
export function checkForecastSufficiency(input: ForecastInput) {
  for (const key of ['calendarDays', 'activeDays', 'acquiredUnitsWithKnownTime'] as const)
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw new DomainError('INVALID_INPUT', 'بيانات تاريخ التوقع غير صالحة.');
  const missing = [];
  if (input.calendarDays < 28) missing.push('28_CALENDAR_DAYS');
  if (input.activeDays < 10) missing.push('10_ACTIVE_DAYS');
  if (input.acquiredUnitsWithKnownTime < 10) missing.push('10_TIMED_ACQUISITIONS');
  if (!input.maintenanceTimeMeasured) missing.push('MAINTENANCE_COST_UNKNOWN');
  if (input.replayPending) missing.push('REPLAY_PENDING');
  if (input.recoveryActive) missing.push('RECOVERY_ACTIVE');
  if (!input.capacityFeasible) missing.push('CAPACITY_CONFLICT');
  if (!input.planStable) missing.push('UNSTABLE_PLAN');
  return { policyVersion: 'P-FC01-1', sufficient: missing.length === 0, missing };
}
/** D08: date/amount calculations remain disabled until an accepted forecast model passes retrospective validation. */
export function forecastSnapshot(input: Partial<ForecastInput> = {}) {
  const values: ForecastInput = { calendarDays: 0, activeDays: 0, acquiredUnitsWithKnownTime: 0,
    maintenanceTimeMeasured: false, replayPending: false, recoveryActive: false,
    capacityFeasible: true, planStable: true, declaredComplete: false, ...input };
  const gate = checkForecastSufficiency(values);
  const status = values.declaredComplete ? 'completed' : !values.capacityFeasible ? 'capacity_infeasible' :
    !values.planStable || values.replayPending || values.recoveryActive ? 'unstable_plan' : 'insufficient_data';
  return { version: 'forecast-gate-1', status, gate,
    reason: values.declaredComplete ? 'أدخلت أنك أتممت الحفظ؛ التحقق يجري تدريجيًا ويستمر التعاهد.' : FORECAST_REFUSAL,
    modelStatus: 'retrospective_validation_pending',
    horizons: { 1: null, 3: null, 6: null, 12: null }, initialCompletionDate: null,
    changesPlan: false, assumptions: [], learningEvidence: false };
}
