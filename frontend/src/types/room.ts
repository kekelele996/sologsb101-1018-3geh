/**
 * 荫房记录（Room）数据模型
 * 每次入荫房的温湿度与出入房时间，是漆层缺陷回溯的关键依据。
 */

/** 判定结论：适宜 / 偏干 / 偏湿 */
export type RoomVerdict = 'suitable' | 'dry' | 'wet';

/**
 * 复测记录：越界后先调环境再测一次，第二次的数才算数。
 * 另存一份挂在原记录上，不覆盖入房测量与判定；同器物同一天只保留一条，重录覆盖。
 */
export interface RoomRemeasure {
  /** 复测温度（摄氏度） */
  tempC: number;
  /** 复测相对湿度（%） */
  humidityPct: number;
  /** 复测入房时间 HH:mm */
  inAt: string;
  /** 复测出房时间 HH:mm */
  outAt: string;
  /** 复测人 */
  operator: string;
  /** 复测判定结论 */
  verdict: RoomVerdict;
  /** 复测登记时间戳 */
  measuredAt: number;
}

export type RoomRemeasureDraft = Omit<RoomRemeasure, 'verdict' | 'measuredAt'>;

export interface Room {
  id: string;
  /** 所属胎体 id */
  bodyId: string;
  /** 记录日期 yyyy-MM-dd */
  date: string;
  /** 荫房温度（摄氏度） */
  tempC: number;
  /** 相对湿度（%） */
  humidityPct: number;
  /** 入房时间 HH:mm */
  inAt: string;
  /** 出房时间 HH:mm */
  outAt: string;
  /** 判定结论（入房那次测量，复测后仍保留原判定） */
  verdict: RoomVerdict;
  /** 复测记录；null 表示未复测，判定与统计仍按入房那次走 */
  remeasure: RoomRemeasure | null;
  createdAt: number;
  updatedAt: number;
}

export type RoomDraft = Omit<Room, 'id' | 'createdAt' | 'updatedAt'>;

export const ROOM_VERDICT_LABEL: Record<RoomVerdict, string> = {
  suitable: '适宜',
  dry: '偏干',
  wet: '偏湿',
};

export const ROOM_VERDICT_COLOR: Record<RoomVerdict, string> = {
  suitable: '#2f6f4f',
  dry: '#c9963c',
  wet: '#3a6ea5',
};

export const ROOM_VERDICT_OPTIONS: ReadonlyArray<{ value: RoomVerdict; label: string }> = [
  { value: 'suitable', label: '适宜' },
  { value: 'dry', label: '偏干' },
  { value: 'wet', label: '偏湿' },
];

export function createEmptyRoomDraft(bodyId: string): RoomDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    bodyId,
    date: today,
    tempC: 24,
    humidityPct: 75,
    inAt: '09:00',
    outAt: '21:00',
    verdict: 'suitable',
    remeasure: null,
  };
}

/** 复测表单初值：默认带入入房那次的读数，便于调环境后改数 */
export function createEmptyRemeasureDraft(room: Room): RoomRemeasureDraft {
  return {
    tempC: room.tempC,
    humidityPct: room.humidityPct,
    inAt: room.inAt,
    outAt: room.outAt,
    operator: '',
  };
}

/** 有效判定：有复测按复测结论，没复测还按入房那次 */
export function effectiveVerdict(room: Room): RoomVerdict {
  return room.remeasure ? room.remeasure.verdict : room.verdict;
}

/** 有效读数：复测存在时取复测的温湿度与出入房时间 */
export interface RoomReading {
  tempC: number;
  humidityPct: number;
  inAt: string;
  outAt: string;
  verdict: RoomVerdict;
  remeasured: boolean;
  operator: string | null;
}

export function effectiveReading(room: Room): RoomReading {
  const remeasure = room.remeasure;
  if (remeasure) {
    return {
      tempC: remeasure.tempC,
      humidityPct: remeasure.humidityPct,
      inAt: remeasure.inAt,
      outAt: remeasure.outAt,
      verdict: remeasure.verdict,
      remeasured: true,
      operator: remeasure.operator,
    };
  }
  return {
    tempC: room.tempC,
    humidityPct: room.humidityPct,
    inAt: room.inAt,
    outAt: room.outAt,
    verdict: room.verdict,
    remeasured: false,
    operator: null,
  };
}
