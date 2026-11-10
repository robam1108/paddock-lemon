"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 진정함 첨부 사진. avatars 와 달리 petitions 버킷은 비공개라
 * getPublicUrl 을 못 쓰고 매번 서명 URL을 받아야 한다.
 * 원본이 크지 않으므로(압축 후 수백 KB) 링크는 그때그때 새로 받는다.
 */
export default function PetitionPhoto({
  supabase,
  path,
}: {
  supabase: SupabaseClient;
  path: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.storage
      .from("petitions")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (active && data) setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [supabase, path]);

  if (!url) return null;

  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="border-line max-h-40 max-w-full border object-contain"
      />
    </a>
  );
}
