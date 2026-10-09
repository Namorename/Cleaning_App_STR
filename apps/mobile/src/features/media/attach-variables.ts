import type { LocalMediaRecord } from './local-store';
import type { AttachMediaVariables } from './use-media';

/**
 * What the upload queue is handed for a file of a task's step: the step, and
 * everything the phone declared about the file when it remembered it.
 *
 * One function for both ways a file reaches a step — a photo taken on the
 * step's own screen, a video sent from the recording screen — so the queue
 * cannot be handed one shape from one and another from the other.
 */
export function stepAttachVariables(
  taskId: string,
  stepId: string,
  record: LocalMediaRecord,
): AttachMediaVariables {
  return {
    taskId,
    stepId,
    uri: record.uri,
    mediaId: record.id,
    kind: record.kind,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    durationSec: record.durationSec,
    takenAt: record.takenAt,
    source: record.source,
  };
}
