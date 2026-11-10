"use client";

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickRadioEmbed } from "@/lib/radio";
import { RACE_NEWS_EMPTY, RACE_NEWS_NONE, raceNews } from "@/lib/copy";
import { toKoreanError } from "@/lib/game";
import { TRACK_NAME, dayLabel, kstTime, type RadioNews } from "@/lib/race";
import MonoLabel from "./ui/MonoLabel";

type Channel = "music" | "race";

/**
 * 라디오를 켜면 뜨는 팝업. "다음 채널"을 누르면 무엇이 걸릴지 모른다 —
 * 음악(RADIO_TRACKS 중 한 곡)이거나 경마 소식이다. 순서 없이 반반으로 고른다.
 * 경마 소식은 걸릴 때마다 다음 경주 출전마 소식을 하나씩 더 풀어 준다(서버
 * race_radio, 사람·경주마다 한도). 한도를 다 들었으면 그 뒤로는 음악만 걸린다.
 * 닫으면 iframe 이 내려가면서 소리도 같이 꺼진다.
 */
export default function RadioPopup({
  supabase,
  raceChannel,
  onClose,
}: {
  supabase: SupabaseClient;
  /** 경마 방송 채널을 잡을 수 있는지 — 경마장 오픈 전에는 관리자만 */
  raceChannel: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<Channel>("music");
  const [src, setSrc] = useState<string | null>(() => pickRadioEmbed());
  const [news, setNews] = useState<RadioNews | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);

  const tuneRace = useCallback(async () => {
    setTuning(true);
    setNewsError(null);
    try {
      const { data, error } = await supabase.rpc("race_radio");
      if (error || !data) setNewsError(toKoreanError(error?.message));
      else setNews(data as RadioNews);
    } catch (e) {
      setNewsError(toKoreanError(e instanceof Error ? e.message : undefined));
    } finally {
      setTuning(false);
    }
  }, [supabase]);

  // 이번 경주 소식을 다 들었는지 — 다 들었으면 소식 채널은 더 걸리지 않는다.
  // (그 경주가 발주되면 다음 경주 소식이 새로 열린다.)
  const exhausted =
    news?.race != null && news.left === 0 && Date.parse(news.race.post_at) > Date.now();

  const nextChannel = () => {
    if (raceChannel && !exhausted && Math.random() < 0.5) {
      setChannel("race");
      tuneRace();
      return;
    }
    setChannel("music");
    setSrc((prev) => pickRadioEmbed(prev));
  };

  const latest = news?.tips[news.tips.length - 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 p-4"
      onClick={onClose}
    >
      <div
        className="border-line w-full max-w-md border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">라디오</MonoLabel>
          <MonoLabel tone="mid">
            {channel === "music" ? "음악" : "무간 경마 소식"}
          </MonoLabel>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {channel === "music" ? (
            src ? (
              <div className="relative aspect-video w-full bg-bg-0">
                <iframe
                  key={src}
                  src={src}
                  title="라디오"
                  className="absolute inset-0 h-full w-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                지직거리는 소리뿐이다.
              </p>
            )
          ) : (
            // 신문 한 귀퉁이처럼 — 날짜줄, 헤드라인, 본문. 지난 소식은 아래로 접힌다.
            <div className="scanline-faint border-line flex min-h-[12.5rem] flex-col gap-2 border bg-bg-0 p-3">
              {tuning && !news ? (
                <p className="mono-13 text-fg-low">주파수를 맞추는 중…</p>
              ) : newsError ? (
                <p className="mono-13 text-loss">{newsError}</p>
              ) : !news?.race ? (
                <p className="body-15 text-fg-mid">{RACE_NEWS_NONE}</p>
              ) : (
                <>
                  <p className="mono-13 text-fg-low border-line-soft border-b pb-1.5">
                    【무간경마】{" "}
                    {news.race.is_test
                      ? "테스트 경주"
                      : `${dayLabel(news.race.day)} 제${news.race.no}경주(${kstTime(news.race.post_at)})`}{" "}
                    · {news.race.distance}m · 주로 {TRACK_NAME[news.race.track]}
                  </p>
                  {latest && news.fresh ? (
                    <article className="flex flex-col gap-1">
                      {(() => {
                        const [head, body] = raceNews(news.race.id, latest.gate, latest.name, latest.level);
                        return (
                          <>
                            <h3 className="title-19 text-fg-hi">{head}</h3>
                            <p className="body-15 text-fg">{body}</p>
                          </>
                        );
                      })()}
                    </article>
                  ) : (
                    <p className="body-15 text-fg-mid">{RACE_NEWS_EMPTY}</p>
                  )}
                  {news.tips.length > (news.fresh ? 1 : 0) && (
                    <ul className="border-line-soft flex flex-col gap-1 border-t pt-1.5">
                      {news.tips.slice(0, news.fresh ? -1 : undefined).map((t) => (
                        <li key={t.gate} className="mono-13 text-fg-mid">
                          · {raceNews(news.race!.id, t.gate, t.name, t.level)[0]}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mono-13 text-fg-low mt-auto">
                    {news.left > 0
                      ? `채널을 다시 맞추면 소식이 ${news.left}건 더 있다.`
                      : "이 경주 소식은 여기까지다."}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={tuning || (!src && !raceChannel)}
              onClick={nextChannel}
              className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
            >
              다음 채널
            </button>
            <button
              type="button"
              onClick={onClose}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid"
            >
              끄기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
