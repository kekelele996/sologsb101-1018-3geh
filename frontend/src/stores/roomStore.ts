/**
 * 荫房记录状态管理（Zustand）
 * 维护荫房记录与超标派生统计；最终判定口径：有复测按复测结论，没复测按入房那次。
 * 任一最终判定越界，即回写关联道次为「待复检」；复测合格则解除标记。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Room, RoomDraft, RoomVerdict } from '@/types/room';
import { effectiveRoomVerdict } from '@/types/roomRetest';
import { judgeVerdict } from '@/utils/humidity';
import { useCoatStore } from './coatStore';
import { useRoomRetestStore } from './roomRetestStore';

/** 取一条入房记录对应的复测（retests 由复测 store 提供） */
function retestOf(roomId: string) {
  return useRoomRetestStore.getState().retests.find((item) => item.roomId === roomId);
}

interface RoomStoreState {
  rooms: Room[];
  loading: boolean;
  ready: boolean;
  error: string;
  loadRooms: () => Promise<void>;
  roomsOfBody: (bodyId: string) => Room[];
  createRoom: (draft: RoomDraft) => Promise<Room>;
  updateRoom: (id: string, patch: Partial<Room>) => Promise<void>;
  removeRoom: (id: string) => Promise<void>;
  /** 按最终判定（复测优先）重算该胎体道次的待复检标记 */
  syncBodyRecheck: (bodyId: string) => Promise<void>;
  /** 超标（偏干 / 偏湿）记录条数，按最终判定口径 */
  overCount: () => number;
  overCountOfBody: (bodyId: string) => number;
  verdictCount: () => Record<RoomVerdict, number>;
}

export const useRoomStore = create<RoomStoreState>((set, get) => ({
  rooms: [],
  loading: false,
  ready: false,
  error: '',

  async loadRooms() {
    set({ loading: true });
    try {
      const rooms = await db.rooms.toArray();
      rooms.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      set({ rooms, loading: false, ready: true, error: '' });
    } catch (error) {
      set({ loading: false, ready: true, error: error instanceof Error ? error.message : '荫房记录读取失败' });
    }
  },

  roomsOfBody(bodyId) {
    return get()
      .rooms.filter((room) => room.bodyId === bodyId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  async createRoom(draft) {
    const now = Date.now();
    const verdict = judgeVerdict(draft.tempC, draft.humidityPct);
    const row: Room = { ...draft, verdict, id: createId('room'), createdAt: now, updatedAt: now };
    await db.rooms.put(row);
    await get().loadRooms();
    // 按最终判定回写关联道次（新记录尚无复测，即入房判定）
    await get().syncBodyRecheck(row.bodyId);
    return row;
  },

  async updateRoom(id, patch) {
    const existing = get().rooms.find((room) => room.id === id);
    if (!existing) return;
    const tempC = patch.tempC ?? existing.tempC;
    const humidityPct = patch.humidityPct ?? existing.humidityPct;
    const verdict = judgeVerdict(tempC, humidityPct);
    await db.rooms.update(id, { ...patch, tempC, humidityPct, verdict, updatedAt: Date.now() } as never);
    await get().loadRooms();
    // 入房读数变化后，最终判定随之变化，重新同步
    await get().syncBodyRecheck(existing.bodyId);
  },

  async removeRoom(id) {
    const existing = get().rooms.find((room) => room.id === id);
    // 复测与入房记录同生共死：删记录一并删掉对应复测（直接落库，避免与复测 store 互相回调）
    const retest = useRoomRetestStore.getState().retests.find((item) => item.roomId === id);
    await db.transaction('rw', [db.rooms, db.roomRetests], async () => {
      if (retest) await db.roomRetests.delete(retest.id);
      await db.rooms.delete(id);
    });
    await useRoomRetestStore.getState().loadRetests();
    await get().loadRooms();
    if (existing) await get().syncBodyRecheck(existing.bodyId);
  },

  async syncBodyRecheck(bodyId) {
    const over = get()
      .rooms.filter((room) => room.bodyId === bodyId)
      .some((room) => effectiveRoomVerdict(room, retestOf(room.id)) !== 'suitable');
    await useCoatStore.getState().markRecheck(bodyId, over);
  },

  overCount() {
    return get().rooms.filter((room) => effectiveRoomVerdict(room, retestOf(room.id)) !== 'suitable').length;
  },

  overCountOfBody(bodyId) {
    return get()
      .rooms.filter((room) => room.bodyId === bodyId && effectiveRoomVerdict(room, retestOf(room.id)) !== 'suitable')
      .length;
  },

  verdictCount() {
    const result: Record<RoomVerdict, number> = { suitable: 0, dry: 0, wet: 0 };
    get().rooms.forEach((room) => {
      result[effectiveRoomVerdict(room, retestOf(room.id))] += 1;
    });
    return result;
  },
}));
