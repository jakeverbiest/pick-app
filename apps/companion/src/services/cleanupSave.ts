/**
 * Save-then-clear ordering for a finished walk.
 *
 * The recovery draft (sessionRecovery.ts) is the only copy of a walk until the
 * cleanup is durably saved. It must be cleared ONLY after the save resolves;
 * on failure it must survive so nothing is lost and the user can retry.
 * Kept free of React / native imports so it can be unit tested under tsx.
 */
export type CleanupSaveResult = { ok: true } | { ok: false; error: unknown };

export async function saveCleanupThenClearDraft(
  save: () => Promise<unknown>,
  clearDraft: () => Promise<void> | void,
): Promise<CleanupSaveResult> {
  try {
    await save();
  } catch (error) {
    return { ok: false, error };
  }
  await clearDraft();
  return { ok: true };
}
