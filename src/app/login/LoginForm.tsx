"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { nameToEmail, normalizeCode, validateCode, validateName } from "@/lib/auth";
import MonoLabel from "@/components/ui/MonoLabel";

export default function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nameError = validateName(name);
    if (nameError) return setError(nameError);
    const codeError = validateCode(code);
    if (codeError) return setError(codeError);

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: nameToEmail(name),
        password: normalizeCode(code),
      });

      if (signInError) {
        setError(
          signInError.message.includes("Invalid login credentials")
            ? "이름 또는 코드가 대장과 일치하지 않는다. 발급받은 그대로 입력하라."
            : signInError.message,
        );
        return;
      }

      router.replace("/play");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "단말 오류. 다시 시도하라.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "border-line w-full border bg-surface px-3 py-3 text-fg-hi outline-none placeholder:text-fg-low focus:border-brass-line";

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-1">
      <MonoLabel tone="low">이름</MonoLabel>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="username"
        placeholder="예: 홍길동"
        className={`${field} body-15 mb-2`}
      />

      <MonoLabel tone="low">코드</MonoLabel>
      <input
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="current-password"
        placeholder="0000-XXXXXX"
        className={`${field} mono-13 text-center tracking-[0.2em] placeholder:tracking-[0.06em]`}
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
        {busy ? "조회 중" : "접속"}
      </button>
    </form>
  );
}
