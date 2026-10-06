/**
 * 荫房复测状态管理（Zustand）
 * 复测与入房记录分开存档：同器物同一天只保留一条复测（重录覆盖），
 * 复测落库后由 roomStore 按「最终判定」重新同步该胎体道次的待复检标记。
 */
import { create } from 'zustand';
import { db, createId } from '@/utils/db';
import { judgeVerdict } from '@/utils/humidity';
import type { Room, RoomVerdict } from '@/types/room';
import type { RoomRetest, RoomRetestDraft } from '@/types/roomRetest';
import { useRoomStore } from './roomStore';

interface RoomRetestStoreState {
  retests: RoomRetest[];
  loading: boolean;
  ready: boolean;
  error: string;
  loadRetests: () => Promise<void>;
  retestOfRoom: (roomId: string) => RoomRetest | undefined;
  /** 同器物同一天的复测（用于去重覆盖） */
  retestOfBodyDate: (bodyId: string, date: string) => RoomRetest | undefined;
  /** 新增或覆盖复测，返回落库记录 */
  upsertRetest: (room: Room, draft: RoomRetestDraft) => Promise<RoomRetest>;
  removeRetestByRoom: (roomId: string) => Promise<void>;
}

export const useRoomRetestStore = create<RoomRetestStoreState>((set, get) => ({
  retests: [],
  loading: false,
  ready: false,
  error: '',

  async loadRetests() {
    set({ loading: true });
    try {
      const retests = await db.roomRetests.toArray();
      retests.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      set({ retests, loading: false, ready: true, error: '' });
    } catch (error) {
      set({
        loading: false,
        ready: true,
        error: error instanceof Error ? error.message : '荫房复测读取失败',
      });
    }
  },

  retestOfRoom(roomId) {
    return get().retests.find((item) => item.roomId === roomId);
  },

  retestOfBodyDate(bodyId, date) {
    return get().retests.find((item) => item.bodyId === bodyId && item.date === date);
  },

  async upsertRetest(room, draft) {
    const now = Date.now();
    const verdict: RoomVerdict = judgeVerdict(draft.tempC, draft.humidityPct);
    // 同器物同一天只留一条：优先按 roomId 命中，其次按 bodyId + date 兜底
    const existing =
      get().retestOfRoom(room.id) ?? get().retestOfBodyDate(room.bodyId, room.date);
    const row: RoomRetest = existing
      ? { ...existing, ...draft, roomId: room.id, bodyId: room.bodyId, date: room.date, verdict, updatedAt: now }
      : {
          ...draft,
          roomId: room.id,
          bodyId: room.bodyId,
          date: room.date,
          verdict,
          id: createId('rrt'),
          createdAt: now,
          updatedAt: now,
        };
    await db.roomRetests.put(row);
    await get().loadRetests();
    // 复测结论算数：按最终判定重新回写该胎体道次待复检
    await useRoomStore.getState().syncBodyRecheck(room.bodyId);
    return row;
  },

  async removeRetestByRoom(roomId) {
    const existing = get().retestOfRoom(roomId);
    if (!existing) return;
    await db.roomRetests.delete(existing.id);
    await get().loadRetests();
    // 删复测后回退到入房那次判定，重新同步
    await useRoomStore.getState().syncBodyRecheck(existing.bodyId);
  },
}));
