import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import { confirmMedia, uploadMediaFile, uploadVideoFile } from '@/features/media/api';
import type { CapturedMedia } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';

import { addOfficeMedia } from './additions';

/**
 * The files the office picks for a task (20261126100000), held in memory across the screens of
 * one go — the screen of the files and the camera that records a video for it — until they are
 * added, or the go is given up. Never on disk: a go the app does not survive is picked again; the
 * files themselves are on the phone and in its gallery.
 */

/** Where a picked file is: waiting, on its way, arrived, or failed (kept to try again). */
export type OfficePickStatus = 'ready' | 'uploading' | 'done' | 'failed';

export interface OfficePick {
  captured: CapturedMedia;
  status: OfficePickStatus;
  error: unknown;
}

/** One go: the batch the files go into, and the files. */
export interface OfficeFlow {
  additionId: string;
  picks: readonly OfficePick[];
}

const flows = new Map<string, OfficeFlow>();
const listeners = new Set<() => void>();
const NO_FLOW: OfficeFlow = { additionId: '', picks: [] };

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function flowOf(problemId: string): OfficeFlow {
  const existing = flows.get(problemId);
  if (existing !== undefined) {
    return existing;
  }
  const fresh: OfficeFlow = { additionId: randomUUID(), picks: [] };
  flows.set(problemId, fresh);
  return fresh;
}

function update(problemId: string, change: (flow: OfficeFlow) => OfficeFlow): void {
  flows.set(problemId, change(flowOf(problemId)));
  emit();
}

/** The go of a task as the screens draw it. */
export function useOfficeFlow(problemId: string): OfficeFlow {
  return useSyncExternalStore(subscribe, () => flows.get(problemId) ?? NO_FLOW);
}

/** The go of a task now, for the code that sends it. */
export function officeFlow(problemId: string): OfficeFlow {
  return flowOf(problemId);
}

/** Whether another file still fits in the batch. */
export function hasRoom(flow: OfficeFlow): boolean {
  return flow.picks.length < ADDITION_MAX_FILES;
}

/** A file taken or chosen: into the go, at its end. One over the batch's size is let go of. */
export function addPick(problemId: string, captured: CapturedMedia): boolean {
  if (!hasRoom(flowOf(problemId))) {
    discardFile(captured.uri);
    return false;
  }
  update(problemId, (flow) => ({
    ...flow,
    picks: [...flow.picks, { captured, status: 'ready', error: null }],
  }));
  return true;
}

/** A file taken out before it was added; its copy on the phone goes with it. */
export function removePick(problemId: string, mediaId: string): void {
  const going = flowOf(problemId).picks.find((pick) => pick.captured.id === mediaId);
  if (going === undefined || going.status === 'uploading' || going.status === 'done') {
    return;
  }
  discardFile(going.captured.uri);
  update(problemId, (flow) => ({
    ...flow,
    picks: flow.picks.filter((pick) => pick.captured.id !== mediaId),
  }));
}

function setStatus(problemId: string, mediaId: string, status: OfficePickStatus, error: unknown) {
  update(problemId, (flow) => ({
    ...flow,
    picks: flow.picks.map((pick) =>
      pick.captured.id === mediaId ? { ...pick, status, error } : pick,
    ),
  }));
}

/** The go is over — added, closed with, or given up: the copies on the phone go, a new batch next. */
export function endFlow(problemId: string): void {
  const flow = flows.get(problemId);
  if (flow === undefined) {
    return;
  }
  for (const pick of flow.picks) {
    discardFile(pick.captured.uri);
  }
  flows.delete(problemId);
  emit();
}

export interface UploadOutcome {
  done: number;
  failed: number;
}

/** One file down the pipeline: the row, the file onto its path, the confirmation. */
async function sendOne(problemId: string, additionId: string, captured: CapturedMedia) {
  const row = await addOfficeMedia(problemId, additionId, captured);
  if (row.uploaded_at !== null) {
    return;
  }
  if (captured.kind === 'video') {
    await uploadVideoFile({
      mediaId: captured.id,
      storagePath: row.storage_path,
      uri: captured.uri,
      mimeType: captured.mimeType,
      byteSize: captured.byteSize,
    });
  } else {
    await uploadMediaFile(row.storage_path, captured.uri, captured.mimeType);
  }
  await confirmMedia(captured.id);
}

/**
 * Send every file of the go not arrived yet, one by one, under the go's batch. A file that fails
 * keeps its place and its error, to be tried again or left out by the manager's choice.
 */
export async function uploadPicks(problemId: string): Promise<UploadOutcome> {
  const { additionId, picks } = flowOf(problemId);
  let done = 0;
  let failed = 0;
  for (const pick of picks) {
    if (pick.status === 'done') {
      done += 1;
      continue;
    }
    setStatus(problemId, pick.captured.id, 'uploading', null);
    try {
      await sendOne(problemId, additionId, pick.captured);
      done += 1;
      setStatus(problemId, pick.captured.id, 'done', null);
    } catch (error: unknown) {
      failed += 1;
      setStatus(problemId, pick.captured.id, 'failed', error);
    }
  }
  return { done, failed };
}
