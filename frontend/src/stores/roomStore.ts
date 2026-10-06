/**
 * 荫房记录状态管理（Zustand）
 * 维护荫房记录与超标派生统计；越界即回写关联道次为「待复检」。
 * 复测另存一份（Room.remeasure），原记录保留入房判定；
 * 待复检回写与超标/适宜统计一律按有效判定（有复测按复测，没复测按入房）。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import type { Room, RoomDraft, RoomRemeasure, RoomRemeasureDraft, RoomVerdict } from '@/types/room';
import { effectiveVerdict } from '@/types/room';
import { judgeVerdict } from '@/utils/humidity';
import { useCoatStore } from './coatStore';

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
  /** 登记/重录复测：同器物同一天只留一条，重复保存覆盖本记录并清除同日其他记录的复测 */
  saveRemeasure: (roomId: string, draft: RoomRemeasureDraft) => Promise<Room | null>;
  /** 超标（偏干 / 偏湿）记录条数，按有效判定 */
  overCount: () => number;
  overCountOfBody: (bodyId: string) => number;
  verdictCount: () => Record<RoomVerdict, number>;
  /** 已复测记录条数 */
  remeasureCount: () => number;
  /** 复测阶段仍越界的记录条数 */
  remeasureOverCount: () => number;
}

/** 按该胎体全部荫房记录的有效判定（复测优先）重算道次「待复检」 */
async function syncBodyRecheck(bodyId: string): Promise<void> {
  const rooms = useRoomStore.getState().rooms.filter((room) => room.bodyId === bodyId);
  const over = rooms.some((room) => effectiveVerdict(room) !== 'suitable');
  await useCoatStore.getState().markRecheck(bodyId, over);
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
    const row: Room = { ...draft, remeasure: draft.remeasure ?? null, verdict, id: createId('room'), createdAt: now, updatedAt: now };
    await db.rooms.put(row);
    await get().loadRooms();
    await syncBodyRecheck(row.bodyId);
    return row;
  },

  async updateRoom(id, patch) {
    const existing = get().rooms.find((room) => room.id === id);
    if (!existing) return;
    const tempC = patch.tempC ?? existing.tempC;
    const humidityPct = patch.humidityPct ?? existing.humidityPct;
    // verdict 始终是入房那次测量的判定；复测另存于 remeasure，不在这里改动
    const verdict = judgeVerdict(tempC, humidityPct);
    await db.rooms.update(id, { ...patch, tempC, humidityPct, verdict, updatedAt: Date.now() } as never);
    await get().loadRooms();
    await syncBodyRecheck(existing.bodyId);
    const nextBodyId = patch.bodyId ?? existing.bodyId;
    if (nextBodyId !== existing.bodyId) await syncBodyRecheck(nextBodyId);
  },

  async removeRoom(id) {
    const existing = get().rooms.find((room) => room.id === id);
    await db.rooms.delete(id);
    await get().loadRooms();
    if (existing) await syncBodyRecheck(existing.bodyId);
  },

  async saveRemeasure(roomId, draft) {
    const target = get().rooms.find((room) => room.id === roomId);
    if (!target) return null;
    const now = Date.now();
    const remeasure: RoomRemeasure = {
      ...draft,
      verdict: judgeVerdict(draft.tempC, draft.humidityPct),
      measuredAt: now,
    };
    // 同器物同一天只留一条复测：重录覆盖本记录，同日其他记录上的复测一并清除
    const siblings = get().rooms.filter(
      (room) => room.id !== roomId && room.bodyId === target.bodyId && room.date === target.date && room.remeasure,
    );
    await db.rooms.update(roomId, { remeasure, updatedAt: now } as never);
    if (siblings.length > 0) {
      await db.rooms.bulkPut(siblings.map((room) => ({ ...room, remeasure: null, updatedAt: now })));
    }
    await get().loadRooms();
    await syncBodyRecheck(target.bodyId);
    return get().rooms.find((room) => room.id === roomId) ?? null;
  },

  overCount() {
    return get().rooms.filter((room) => effectiveVerdict(room) !== 'suitable').length;
  },

  overCountOfBody(bodyId) {
    return get().rooms.filter((room) => room.bodyId === bodyId && effectiveVerdict(room) !== 'suitable').length;
  },

  verdictCount() {
    const result: Record<RoomVerdict, number> = { suitable: 0, dry: 0, wet: 0 };
    get().rooms.forEach((room) => {
      result[effectiveVerdict(room)] += 1;
    });
    return result;
  },

  remeasureCount() {
    return get().rooms.filter((room) => room.remeasure).length;
  },

  remeasureOverCount() {
    return get().rooms.filter((room) => room.remeasure != null && room.remeasure.verdict !== 'suitable').length;
  },
}));
