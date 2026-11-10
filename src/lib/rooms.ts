/**
 * 방 배치.
 *
 * 배정 자체은 DB(public.cells / profiles.cell_id, app.assign_cell())가 결정하고,
 * 매주 월요일 06:00 KST 에 app.cell_rotate() 가 전원을 다시 섞는다.
 * 여기서는 그 결과를 사람이 보기 좋게 방 단위로 묶는 것만 한다.
 */

/** 3인 1실. app.cell_capacity() 와 짝이다. */
export const ROOM_CAPACITY = 3;

export type Room = {
  /** "4동 08실" — app.cell_label() 이 만든 라벨을 그대로 쓴다. */
  cell: string;
  members: string[];
};
