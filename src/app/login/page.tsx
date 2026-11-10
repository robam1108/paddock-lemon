import LoginForm from "./LoginForm";
import Texture from "@/components/ui/Texture";
import MonoLabel from "@/components/ui/MonoLabel";
import { DISCLAIMER, SITE_LINE } from "@/lib/site";

/** 로그인 화면. 계정은 관리자가 발급한다. */
export default function LoginPage() {
  return (
    <div className="bg-bg-0 relative flex min-h-dvh items-center justify-center p-4">
      <Texture />

      <main className="border-line relative z-1 w-full max-w-sm border bg-bg-1">
        <div className="scanline border-line-soft flex min-h-8 items-center border-b px-3.5 py-1.5">
          <MonoLabel tone="low">{SITE_LINE}</MonoLabel>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-fg-hi">로그인</p>
          <p className="body-15 text-fg-mid">발급받은 아이디와 비밀번호를 입력해 주세요.</p>

          <LoginForm />

          <p className="mono-13 text-fg-low mt-3">
            계정은 관리자가 발급합니다. 아이디나 비밀번호를 잊었다면 관리자에게 문의해 주세요.
          </p>
          <p className="mono-13 text-fg-low mt-2">{DISCLAIMER}</p>
        </div>
      </main>
    </div>
  );
}
