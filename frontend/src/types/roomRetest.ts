/**
 * 荫房复测（RoomRetest）数据模型
 * 现场惯例：温湿度越界先标记道次「待复检」，调整荫房环境后再测一次，
 * 第二次读数才算数。复测与入房那次记录分开存档：
 * - Room 保留入房时的读数与判定（缺陷回溯证据，不再回写覆盖）
 * - RoomRetest 记录复测温湿度、复测出入房时间与复测人
 * 同器物（bodyId）同一天（date）只保留一条复测，重录覆盖。
 */
import type { Room } from './room';
import type { RoomVerdict } from './room';

export interface RoomRetest {
  id: string;
  /** 关联荫房记录 id（一次入房记录对应至多一条复测） */
  roomId: string;
  /** 所属胎体 id（冗余，便于同器物同日去重与级联删除） */
  bodyId: string;
  /** 复测日期 yyyy-MM-dd，与入房记录同日 */
  date: string;
  /** 复测温度（摄氏度） */
  tempC: number;
  /** 复测相对湿度（%） */
  humidityPct: number;
  /** 复测入房时间 HH:mm */
  retestInAt: string;
  /** 复测出房时间 HH:mm */
  retestOutAt: string;
  /** 复测人 */
  operator: string;
  /** 复测判定结论（按复测读数重新判定） */
  verdict: RoomVerdict;
  createdAt: number;
  updatedAt: number;
}

export type RoomRetestDraft = Omit<RoomRetest, 'id' | 'bodyId' | 'date' | 'verdict' | 'createdAt' | 'updatedAt'>;

/**
 * 最终判定口径：有复测按复测结论，没复测按入房那次。
 * 道次待复检、荫房页超标次数与适宜占比都消费该口径。
 */
export function effectiveRoomVerdict(room: Room, retest?: RoomRetest): RoomVerdict {
  return retest ? retest.verdict : room.verdict;
}

/** 最终采用的读数（温湿度）：有复测按复测，没有按入房 */
export function effectiveRoomReading(room: Room, retest?: RoomRetest): { tempC: number; humidityPct: number } {
  return retest ? { tempC: retest.tempC, humidityPct: retest.humidityPct } : { tempC: room.tempC, humidityPct: room.humidityPct };
}

/** 复测默认录入值：复测入房时间接在原出房之后，温湿度回到适宜区间，复测人留空待填 */
export function createEmptyRetestDraft(room: Room): RoomRetestDraft {
  const addHour = (hhmm: string): string => {
    const [h, m] = hhmm.split(':').map((item) => Number.parseInt(item, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
    return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return {
    roomId: room.id,
    tempC: 24,
    humidityPct: 75,
    retestInAt: room.outAt,
    retestOutAt: addHour(room.outAt),
    operator: '',
  };
}
