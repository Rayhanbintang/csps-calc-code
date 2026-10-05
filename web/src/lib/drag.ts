// What is being dragged right now. Browsers hide drag data until the drop, so drop
// zones read this to decide whether to accept the drag while it hovers.
import { find } from './store.svelte';
import { canHold, contains } from './tree';

export const drag: { svc?: string; ids?: string[] } = {};

export function startService(e: DragEvent, svc: string): void {
  drag.svc = svc;
  drag.ids = undefined;
  e.dataTransfer?.setData('application/x-csps-svc', svc);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
}

export function startItems(e: DragEvent, ids: string[]): void {
  drag.ids = ids;
  drag.svc = undefined;
  e.dataTransfer?.setData('application/x-csps-items', JSON.stringify(ids));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

export function endDrag(): void {
  drag.svc = undefined;
  drag.ids = undefined;
}

/** Whether the current drag may drop into a container (parentId) or a box (none). */
export function accepts(parentId?: string): boolean {
  const parent = parentId ? find(parentId)?.item : undefined;
  const parentSvc = parent?.svc ?? null;
  if (drag.svc) return canHold(parentSvc, drag.svc);
  if (drag.ids?.length) {
    return drag.ids.some((id) => {
      const f = find(id);
      if (!f) return false;
      if (parent && contains(f.item, parent.id)) return false;
      return canHold(parentSvc, f.item.svc);
    });
  }
  return false;
}
