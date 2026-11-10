/* ---------------- 라디오 ---------------- */

/** 라디오 아이템 코드. 소지품에서 이 코드만 `켜기` 로 팝업을 연다(서버 radio_on). */
export const RADIO = "radio";

/**
 * 라디오가 트는 곡. 켤 때마다 이 중 하나를 고른다.
 * 유튜브 주소를 그대로 넣으면 된다 — watch?v= · youtu.be/ · shorts/ · embed/ 모두 받는다.
 */
export const RADIO_TRACKS: string[] = [
  "https://youtu.be/O4mIJji998s?si=IANOopStk5RHRHBw",
  "https://youtu.be/tX4rUDi_ER4?si=fFQzI7mVMevIwtfd",
  "https://youtu.be/TOSrdHy5KRc?si=WTPOScesFcfFB-si",
  "https://youtu.be/30LxaF4fd3A?si=26cDJad2APZHo9m2",
  "https://youtu.be/t4ySfBuW4FQ?si=O66mfvGiNH-DgmuB",
  "https://youtu.be/ubu4z-7sCYM?si=piqumFeZ-h1TOkF9",
  "https://youtu.be/lLFoLJIXayk?si=9q9oVaR7upvVgI5f",
  "https://youtu.be/6YuSTPW9uiQ?si=rOjLVNhBl9KQv3_L",
  "https://youtu.be/tobsTmNoDHk?si=aK3w4GsRKivAncCS",
  "https://youtu.be/zO6sW9NAik8?si=3MBM_2IpzCVnNgK9",
  "https://youtu.be/NBTg7Ii8v1w?si=_DnyC0a1J3fPgb9P",
  "https://youtu.be/BjwQ6l1wx7s?si=B2_7errvmuZDcPgl",
  "https://youtu.be/RD6Rm_Q82lU?si=5kqxhFyHitE5Yfx1",
  "https://youtu.be/kQifEUVW_X4?si=bmklHkbOVoY4YWm9",
  "https://youtu.be/VXMiWzZNv_Y?si=qDNp3n-NIO9S4BFz",
  "https://youtu.be/ccPmMl8ahC4?si=QcpXXrqQk-KJMBsn",
  "https://youtu.be/jmRI3Ew4BvA?si=fZIDvIO9d4ZrB0Tc",
  "https://youtu.be/9wxI4KK9ZYo?si=D5n7oYPzYtSkSHdO",
  "https://youtu.be/oTfH4GmSAyA?si=RxJwa_rRIU1V56yQ",
  "https://youtu.be/FXn7YpAuaFU?si=H8c2kKCFIcJTXAhH",
  "https://youtu.be/Gb0IMMwQQtw?si=qYI8wWLIW6aujkBP",
  "https://youtu.be/6z7RITKC8vg?si=ix7mOItlQms3gMIK",
  "https://youtu.be/bMrwm7TXWAo?si=5KPwkZzhJYjQr0Bz",



];

/** 유튜브 주소에서 영상 id 를 뽑는다. 못 알아보면 null. */
export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

/** 곡 목록에서 하나를 골라 embed 주소로 돌려준다. 직전 곡은 되도록 피한다. */
export function pickRadioEmbed(prev?: string | null): string | null {
  const ids = RADIO_TRACKS.map(youtubeId).filter((x): x is string => !!x);
  if (ids.length === 0) return null;
  const pool = ids.length > 1 ? ids.filter((id) => !prev?.includes(id)) : ids;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return `https://www.youtube.com/embed/${id}?autoplay=1`;
}
