/**
 * Projection de l'inventaire depuis les events `item_*` (game-formats.md §1 : la possession est une projection).
 * Sert de référence pour vérifier que l'état projeté égale l'état rejoué.
 */
import type { EventRecord } from '../state/journal.js';
import type { Id } from '../state/types.js';
import type { ItemStateName } from '../state/format-state.js';

export interface ItemSlot {
  itemDefId: Id;
  holderId: Id | null;
  locationId: Id | null;
  hidden: boolean;
  state: ItemStateName;
  isFake: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Rejoue les events d'objet (ordre de `seq`) et renvoie l'emplacement de chaque objet. */
export function projectInventory(events: readonly EventRecord[]): Record<Id, ItemSlot> {
  const slots: Record<Id, ItemSlot> = {};
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const p = e.payload;
    const itemId = str(p['itemId']);
    if (!itemId || !e.type.startsWith('item_')) continue;
    const slot = slots[itemId];
    switch (e.type) {
      case 'item_placed':
        slots[itemId] = {
          itemDefId: str(p['itemDefId']) as Id,
          holderId: null,
          locationId: str(p['locationId']),
          hidden: p['hidden'] === true,
          state: 'active',
          isFake: false,
        };
        break;
      case 'item_faked':
        slots[itemId] = {
          itemDefId: str(p['itemDefId']) as Id,
          holderId: str(p['by']),
          locationId: null,
          hidden: false,
          state: 'active',
          isFake: true,
        };
        break;
      case 'item_found':
      case 'item_picked_up':
      case 'item_given':
      case 'item_traded':
      case 'item_stolen':
        if (slot) Object.assign(slot, { holderId: str(p['to']), locationId: null, hidden: false });
        break;
      case 'item_hidden':
        if (slot) Object.assign(slot, { holderId: null, locationId: str(p['locationId']), hidden: true });
        break;
      case 'item_used':
        if (slot) slot.state = str(p['state']) as ItemStateName;
        break;
      case 'item_expired':
        if (slot) slot.state = 'expired';
        break;
      default:
        break; // item_shown : aucune modification
    }
  }
  return slots;
}
