import LoginForm from "./LoginForm";
import Texture from "@/components/ui/Texture";
import MonoLabel from "@/components/ui/MonoLabel";
import { FORM_LINE } from "@/lib/copy";

/**
 * 단말 접속 화면.
 *
 * 여기는 아직 시설의 것이다 — 판이 얹히기 전이라 놋쇠가 한 군데도 없고,
 * 문구도 전부 공문 어투다. 환영 인사는 없다. 확인만 한다.
 */
export default function LoginPage() {
  return (
    <div className="bg-bg-0 relative flex min-h-dvh items-center justify-center p-4">
      <Texture />

      <main className="border-line relative z-1 w-full max-w-sm border bg-bg-1">
        {/* 서식 스트립. 본 화면과 같은 줄이 여기서부터 이미 켜져 있다. */}
        <div className="scanline border-line-soft flex min-h-8 items-center border-b px-3.5 py-1.5">
          <MonoLabel tone="low">{FORM_LINE}</MonoLabel>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-fg-hi">단말 접속</p>
          <p className="body-15 text-fg-mid">
            발급받은 이름과 코드를 입력하라. 접속 기록은 남는다.
          </p>

          <LoginForm />

          <p className="mono-13 text-fg-low mt-3">
            계정은 관리자가 직접 발급한다. 이름이나 코드를 잊었으면 관리자에게
            문의하라.
          </p>
        </div>
      </main>
    </div>
  );
}
