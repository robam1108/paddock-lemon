/**
 * 피드백 첨부용 압축. AvatarCropper.tsx 와 같은 캔버스 인코딩이지만
 * 자르기 없이 긴 변만 줄인다 — 사진의 어느 부분도 잘라 내면 안 되는
 * 증빙용 첨부라서다.
 */
export async function compressImage(
  file: File,
  maxEdge = 1400,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("ENCODE_FAILED"))),
      "image/jpeg",
      quality,
    );
  });
}
