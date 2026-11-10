/* ---------------- 운동기구 · 악기 ---------------- */

/** 운동기구·악기 아이템 코드. 소지품에서 이 코드들만 `착용`(악기는 `연주`)으로 1시간 켠다(서버 gear_on).
 *  쓴다고 사라지지 않고, 1시간이 끝나야 다시 켤 수 있다. 서버 app.gear_codes() 와 같게. */
export const GEAR: ReadonlySet<string> = new Set(["dumbbell", "hand_gripper", "harmonica", "recorder"]);

/** GEAR 중 악기. 버튼이 `연주` 이고 팝업 문장이 운동 대신 연주로 바뀐다. */
export const INSTRUMENTS: ReadonlySet<string> = new Set(["harmonica", "recorder"]);
