"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmail, validatePassword, validateUsername } from "@/lib/auth";
import { toKoreanError } from "@/lib/errors";
import MonoLabel from "@/components/ui/MonoLabel";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 게스트 체험 — 서버(app.guest_open)가 열어 둔 경우에만 버튼을 보인다.
  const [guest, setGuest] = useState<{ open: boolean; ttl_hours: number } | null>(null);

  useEffect(() => {
    createClient()
      .rpc("guest_status")
      .then(({ data }) => setGuest((data as { open: boolean; ttl_hours: number } | null) ?? null));
  }, []);

  /** 익명 로그인. 아이디(guest + 숫자)는 서버 트리거가 정한다. */
  async function handleGuest() {
    setError(null);
    setBusy(true);
    try {
      const { error: guestError } = await createClient().auth.signInAnonymously();
      if (guestError) {
        setError(
          /anonymous sign-ins are disabled/i.test(guestError.message)
            ? "지금은 게스트 체험을 열어 두지 않았습니다."
            : toKoreanError(guestError.message),
        );
        return;
      }
      router.replace("/play");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "게스트 입장 중 오류가 났습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const idError = validateUsername(username);
    if (idError) return setError(idError);
    const pwError = validatePassword(password);
    if (pwError) return setError(pwError);

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });

      if (signInError) {
        setError(
          signInError.message.includes("Invalid login credentials")
            ? "아이디 또는 비밀번호가 맞지 않습니다."
            : signInError.message,
        );
        return;
      }

      router.replace("/play");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 중 오류가 났습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "border-line w-full border bg-surface px-3 py-3 text-fg-hi outline-none placeholder:text-fg-low focus:border-brass-line";

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-1">
      <MonoLabel tone="low">아이디</MonoLabel>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="예: demo01"
        className={`${field} body-15 mb-2`}
      />

      <MonoLabel tone="low">비밀번호</MonoLabel>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="비밀번호"
        className={`${field} body-15`}
      />

      {error && (
        <p className="mono-13 border-loss/40 mt-2 border bg-bg-2 px-3 py-2 text-loss">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="state-fade title-19 border-line mt-3 min-h-12 border bg-surface-hi text-fg-hi disabled:text-fg-low"
      >
        {busy ? "확인 중" : "로그인"}
      </button>

      {guest?.open && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={handleGuest}
            className="state-fade title-19 border-brass-line mt-2 min-h-12 border bg-brass-fill text-fg-hi disabled:text-fg-low"
          >
            로그인 없이 체험하기
          </button>
          <p className="mono-13 text-fg-low mt-1">
            게스트 계정은 {guest.ttl_hours}시간 뒤 기록과 함께 지워집니다.
          </p>
        </>
      )}
    </form>
  );
}
