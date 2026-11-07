import { DomainError, type LearningEvent } from "../core/types";
import { validateEvent } from "../persistence/event-store";

const envelopeKeys = ["eventId", "commandId", "operationId", "userId", "unitId", "type", "occurredAt", "receivedAt", "zoneId", "source", "coverage", "versions", "data"];
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Strict storage metadata validation; does not change any valid learning
 * command, historical rating, event version, HME criterion or FSRS result. */
export function validateLearningEventEnvelope(event: LearningEvent): void {
  validateEvent(event);
  if (!hasExactKeys(event, envelopeKeys) || event.operationId !== event.commandId)
    throw new DomainError("INVALID_INPUT", "غلاف واقعة التعلم أو هوية عمليتها غير متوافق.");
  if (event.data.scope !== "hme" || !hasExactKeys(event.data,
    event.type === "LearnerInitialized" ? ["scope"] : ["scope", "command"]))
    throw new DomainError("INVALID_INPUT", "بيانات واقعة التعلم تحتوي حقولًا غير مدعومة أو ناقصة.");
}
