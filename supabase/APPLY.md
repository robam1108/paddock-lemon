# 적용 순서

이 문서가 **유일한 정본**이다. 파일 이름 앞의 번호가 곧 순서다 — 00 부터 24 까지
차례대로 Supabase **SQL Editor** 에 붙여넣고 실행한다. 24 까지가 전부다.

## 두 가지 규칙

> **1. 라이브 DB 에 파일 전체를 다시 돌리지 않는다.**
> 바뀐 절만 떼어 `repair/<날짜>_<무엇>.sql` 로 만들어 그것만 돌린다.
> 본문은 반드시 번호 파일에서 **복사**한다 — 손으로 다시 쓰면 두 곳이 어긋난다.
>
> **2. 함수 몸통은 한 파일에만 둔다.**
> 같은 함수가 두 곳에 보이면 그게 버그다. 나중에 도는 쪽이 이기므로, 언젠가
> 반드시 조용히 되감긴다. (2026-09-18 사고가 정확히 이것이었다 — 옛 `schema.sql`
> 을 통째로 실행해 `play_game` · `get_my_state` · `handle_new_user` 가 초기 버전으로
> 덮이고 RLS 정책 둘이 풀렸다.)

## ★ 값을 바꿀 때 고치는 파일은 셋뿐이다

| 파일 | 여기서 바꾸는 것 |
|---|---|
| **`00_rules.sql`** | 하루 판수 · 발급 코인 · 체력 · 병동 시간 · 배당 · 일당 · 하이로우 상한 · **동시 장착 수**(`app.flex_wear_limit`) · **동시 소모 과시 수**(`app.flex_consume_limit`) · 숨김 계정 이름 · **추석 송편**(쿠폰 지급 시각 · 끝나는 시각 · 뽑기 분포 · 등급별 효과, `app.chuseok_*`) · **탐색 고양이**(츄르 횟수 · 보은 확률·시간·품목, `app.cat_*`) |
| **`01_special_meal.sql`** | 특선 도시락이 나가는 날짜 (한 줄) |
| **`17_items.sql`** | 아이템 목록 — 이름 · 설명 · 가격 · 개비 수 · 과시 문구 · **판돈 추가**(네잎클로버의 `stake_bonus`) |

고친 뒤 **그 파일 하나만** 다시 돌리면 된다. 셋 다 테이블을 건드리지 않는다
(`17_items.sql` 은 `item_defs` 행만 `on conflict do update` 로 갱신한다).

표시용 값은 `src/lib/game.ts` 의 `PLAY_LIMIT` · `PLAY_WAGE` · `ROULETTE_*` ·
`SLOT_PAIR_MULT` · `HL_EDGE` · `HL_MAX_MULT` 에도 같이 반영한다.

## 순서

| # | 파일 | 무엇 |
|---|---|---|
| 00 | `00_rules.sql` | ★ 규칙 상수. `02_schema.sql` 의 최상위 문장이 이것들을 쓰므로 반드시 맨 앞 |
| 01 | `01_special_meal.sql` | ★ 특선 도시락 스위치 (날짜 · 품목 코드 · 슬롯 선택 함수) |
| 02 | `02_schema.sql` | 테이블 · 게임 로직(`play_game` · 하이로우 · 배급소 · 아이템 사용) · 관리자 RPC · RLS |
| 03 | `03_pvp.sql` | 흑색구역 1:1 대전(주사위 · 인디언 · 블랙잭). 하루 배정 횟수를 쓰지 않는다 |
| 04 | `04_trade.sql` | 개인 거래 · 원장(`ledger` 조회) |
| 05 | `05_smuggle.sql` | 밀거래 · 라스트 카드 · 가축 지목권(500 + 살 때마다 100, 10일 지나면 초기화) · 호칭권(150) |
| 06 | `06_relations.sql` | 소식(관계) · 수감자 목록 · 한글 조사 도우미 |
| 07 | `07_petitions.sql` | 진정함 |
| 08 | `08_admin.sql` | 계정 발급 · SQL Editor 전용 관리자 함수 |
| 09 | `09_avatar.sql` | 신원표 사진(Storage 버킷 · 업로드 RPC) |
| 10 | `10_extra_plays.sql` | 식량 · 의약품 · 약물의 횟수 회복 하루 총량(8)을 공유시켜 최대 28판으로 맞춘다 |
| 11 | `11_item_uses.sql` | 아이템 하나에 여러 번 쓰는 사용 횟수(담배 개비 수 등) |
| 12 | `12_ward_grace.sql` | 병동 남은 시간이 48시간을 넘겨 표시되던 것을 고친다 |
| 13 | `13_cell_rotation.sql` | 수용실 주간 재배치(월 06:00 KST). **실행 전 Database → Extensions 에서 `pg_cron` 을 켠다** |
| 14 | `14_ward_ladder.sql` | 병동 수용 시간을 사다리(14 → 18 → 24 → 36 → 48시간)로. 퇴원 후 72시간 무입원이면 첫 칸으로(`app.ward_reset_hours`, 퇴원 시각 `ward_left_at` 은 02 의 트리거가 찍는다). 퇴원 체력 30 → 80 |
| 15 | `15_steal.sql` | 배급소 · 밀거래 훔치기. 클라이언트 배포보다 **먼저** 돌린다 |
| 16 | `16_steal_trick.sql` | 밀거래 훔치기 확률 상향 · 훔친 물건 문구 · 아이템 **절도비법** |
| 17 | `17_items.sql` | ★ 아이템 카탈로그 정본. 11·16 이 만든 컬럼(`uses` · `steal_sure` · `flex_text_stolen`)을 채우므로 **그 뒤에** 온다 |
| 18 | `18_labor.sql` | 작업장. 보수표(`labor_defs`)는 RLS 만 켜고 정책을 만들지 않아 클라이언트에 안 나간다 |
| 19 | `19_search.sql` | 탐색. 17 이 만든 **비상식량**(`emg_ration`) 코드를 쓰므로 그 뒤에 온다 |
| 20 | `20_chuseok.sql` | 추석 랜덤 송편 이벤트(한정, 9/26 KST 까지). 9/24 저녁 배급 때 받은 송편 쿠폰을 쓰면 뽑기(쿠폰 지급은 02 의 `app.accrue`). 뽑기 표 · 뽑기(쿠폰 소모)/다시 뽑기/받기 · 송편 먹기(`use_songpyeon`) · 9/27 정리 예약(pg_cron). 17 의 송편 쿠폰 · 송편 세 품목을 쓰므로 그 뒤에 온다 |
| 21 | `21_radio.sql` | 라디오 켜기(`radio_on`). 소모 없이 보유만 확인하고 과시 문구를 1시간 붙인다(`app.flex_apply`). 17 의 라디오 행을 쓰므로 그 뒤에 온다 |
| 22 | `22_horse_race.sql` | 흑색구역 **경마장**. 경주마 20두(`race_horses`) · 하루 2경주(10:00 · 22:00 KST, 8두) · 고정배당(공개 정보로 몬테카를로, 공제율 `app.race_take`) · 단승/연승/복승 · 경주당 20~300코인 · 마권 한 장마다 체력 1(`app.hp_per_play`) · 라디오 CH2 속보(`race_radio`) · 정산 pg_cron(`race-settle`) + lazy. 손잡이는 파일 맨 위 `app.race_*`. `app.race_public()` 은 true(정식 오픈 — 클라이언트 `RACE_PUBLIC` 과 같이). false 로 돌리면 시험 계정(관리자 권한 + 이름 `app.race_tester_name()` = 관리자)만 쓰고, 그 계정이 `race_admin_test` 로 시각과 무관한 테스트 경주(코인 불변)를 돌린다. 새 테이블·새 함수뿐이라 라이브에도 통째로 돌린다. `game_rounds_game_check` 에 `race` 를 더한다 |
| 23 | `23_gear.sql` | 운동기구(아령·악력기) 착용(`gear_on`) · 해제(`gear_off`). 라디오처럼 소모 없이 보유만 확인하고 과시 문구를 1시간 붙인다(`app.flex_apply`). 해제하면 문구가 바로 사라지고, 언제든 다시 착용한다. 대상 목록은 `app.gear_codes()`. 17 의 운동기구 행을 쓰므로 그 뒤에 온다. 새 함수뿐이라 라이브에도 통째로 돌린다 |
| 24 | `24_cat.sql` | 탐색 **고양이**. 유저·날짜마다 정해지는 고양이 자리(`app.cat_place`)를 탐색하면 물건 대신 고양이를 만나(19 의 `search_look`) 간식주기·쓰다듬기 중 하나(`cat_act`). 츄르를 `app.cat_friend_need()` 번 준 뒤 쓰다듬기에 성공하면 **내가 부를 이름**을 짓는다(`cat_set_name`, 사람마다 따로). 그 뒤 츄르를 주면 `app.cat_gift_rate()` 확률로 `app.cat_gift_delay()` 뒤 보은(죽은 새·쥐·벌레, 거래 불가)이 온다(`cat_gifts_pending` · `cat_gift_resolve`). 소지품에서 몰래버리기(`cat_gift_toss`), 쓰면(`cat_gift_use`) 품목마다 효과 하나 — 죽은 새 `app.cat_bird_plays()` 판 판돈 +`app.cat_bird_stake()`(02 의 `app.bonus_stake` 가 `app.cat_bless_charge` 를 부른다) · 죽은 쥐 다음 훔치기 성공률 +`app.cat_mouse_steal()`(16 의 `app.cat_steal_bonus`) · 죽은 벌레 다음 작업을 band high 로(18 의 `app.cat_labor_good_take`). 효과 설명은 화면 사용 팝업에만. 보은을 가장 많이 가진 사람(`cat_favorite`)의 특이사항 맨 아래에 한 줄. 손잡이는 00 의 `app.cat_*`. **공개 스위치 `app.cat_public()`** 이 false 인 동안은 시험 계정(19 의 `app.search_is_tester` — 관리자 권한 + 이름 '관리자')만 고양이를 만나고, 그 계정은 하루 한 번 제한·체력 없이 탐색하며 탐색 탭 테스트 패널(`cat_test`)을 쓴다. 공개할 때: 패널 "초기화" → `app.cat_public()` true → 17 의 츄르 buy_price 50. 17 의 품목 행을 FK 로 쓰므로 그 뒤에 온다. 새 테이블·새 함수뿐이라 라이브에도 통째로 돌린다 |

### 순서가 중요한 자리

- **00 → 02**: `02_schema.sql` 의 최상위 `update`/`insert` 가 `app.hidden_name()` ·
  `app.cell_week_kst()` 를 직접 부른다. 00 이 없으면 그 자리에서 멈춘다.
- **11 · 16 → 17**: `17_items.sql` 이 `item_defs.uses` · `steal_sure` ·
  `flex_text_stolen` 을 채운다. 컬럼이 없으면 에러가 난다.
- **17 → 18 · 19**: 작업장과 탐색이 아이템 코드로 인벤에 넣는다. 카탈로그가
  먼저 차 있어야 없는 코드로 등록을 시도하지 않는다.
- **13 전에 `pg_cron`**: 꺼져 있어도 파일은 끝까지 돌지만 예약이 안 걸린다.
  확장을 켠 뒤 13 을 다시 돌리면 된다.
  - 예약 확인: `select jobname, schedule, active from cron.job where jobname = 'cell-rotate-weekly';`
  - `show timezone;` 이 `UTC` 여야 한다 (일 21:05 UTC = 월 06:05 KST)

## 폴더

| 폴더 | 무엇 |
|---|---|
| `repair/` | 라이브 DB 에 적용하는 일회성 스크립트. **새로 설치할 때는 하나도 돌리지 않는다** |
| `archive/` | 이미 본문에 반영된 지난 패치. 실행하지 않는다 (기록용) |

## 새 규칙을 얹을 때

1. 해당 번호 파일의 함수 몸통을 고친다 — 사본을 새로 만들지 않는다.
2. 라이브 DB 용으로 그 절만 복사해 `repair/<날짜>_<무엇>.sql` 을 만든다.
3. 돌린 뒤에는 `repair/README.md` 표에 한 줄 적는다.

인자를 **늘리거나 줄일 때**는 `create or replace function` 으로 안 된다.
`drop function if exists <옛 시그니처>;` 를 먼저 하고, 새 시그니처로
`revoke`/`grant` 를 다시 걸어야 한다 — 안 그러면 오버로드 둘이 공존해 호출이
모호해진다. `repair/2026-09-18_admin_reason.sql` 이 그 예다.

## 남은 중복 (알고 두는 것)

`02_schema.sql` 은 10~16 번 패치의 **최종본을 함께 들고 있는 합본**이라, 같은 함수
몸통이 두 곳 이상에 있다. 나중에 도는 쪽이 이기므로, 뒤에 오는 사본이 앞의 것보다
낡으면 그 순간 기능이 조용히 되감긴다.

> **2026-09-20 기준으로 낡은 사본은 하나도 없다.** 아래 표의 중복은 전부 **본문이
> 글자까지 같다.** 그래서 어느 파일을 단독으로 다시 돌려도 되감기지 않는다.
> 예전에는 `05`·`10`·`11`·`15` 가 옛 본문을 들고 있어서, 그 파일만 떼어 돌리면
> 절도비법·훔친 문구·밀거래 확률이 소리 없이 사라졌다 — 그 사본 여덟을 지우고
> 자리마다 "정본은 어느 파일" 이라는 주석만 남겼다.

| 함수 | 있는 곳 | 비고 |
|---|---|---|
| `app.accrue` | 02 · 12 · 14 | 본문 동일 |
| `app.spend_hp` | 02 · 14 | 본문 동일 |
| `app.discharge_hp` · `app.ward_hours(integer)` | **00** · 14 | 본문 동일. ★ 값을 바꿀 때 **둘 다** 고쳐야 한다 |
| `app.max_extra_plays` | **00** · 10 | 본문 동일. ★ 위와 같다 |
| `app.state_json` | 02 · 16 | 본문 동일 |
| `public.use_item` | 02 · 16 | 본문 동일 |
| `public.flex_equip` | 02 · 16 | 본문 동일 |
| `public.flex_unequip` | 02 | 사본 없음 |
| `app.consume_steal_trick` | 02 · 16 | 본문 동일 |
| `public.shop_steal` | 02 · 16 | 본문 동일 |
| `public.sell_item` · `app.take_one_item` | 02 · 16 | 본문 동일 |
| `public.smuggle_steal` | **16** | 사본 없음 (권한도 16 이 건다) |
| `app.in_withdrawal` · `app.addict_lines` | **02** | 사본 없음 (중독·금단 문장은 여기 하나에서만 정한다) |
| `public.smuggle_reroll` · `app.roll_smuggle` | **05** | 사본 없음 |
| `public.smuggle_state` · `app.roll_special` | **16** | 사본 없음 (권한도 16 이 건다. 05 의 옛 사본은 2026-11-07 에 지웠다) |
| `app.smuggle_special_*` · `app.roll_specials` · `app.smuggle_today` · `public.smuggle_buy` | **05** | 사본 없음 |
| `app.smuggle_steal_base` · `app.smuggle_value_cap` | 05 · 16 | 본문 동일 |
| `app.move_items` | 04 · 16 | 본문 동일 |
| `public.inmate_roster` | 06 · 16 | 본문 동일 |
| `app.shop_steal_base` · `steal_value_cap` · `steal_rate` · `steal_penalty` · `public.shop_catalog` | 02 · 15 | 본문 동일 |
| `public.flex_use` · `panel_players` · `panel_player` · `panel_take_item` | 02 · 11 | 본문 동일 |
| `app.assign_cell` · `cell_rotate` · `cell_week_kst` · `pick_shuffled` | 02 · 13 | 본문 동일 |

**함수를 고칠 때는 그 함수가 있는 파일을 전부 찾아 같이 고친다.**
확인하는 가장 빠른 방법:

```bash
grep -n "create or replace function app.accrue" supabase/*.sql
```

낡은 사본이 다시 생기지 않았는지는 본문을 통째로 비교해 보면 된다 — 같은 함수인데
해시가 다르면 그게 버그다(인자 수가 다른 `app.ward_hours` 오버로드 둘은 예외).

이 중복 자체를 없애려면 10~16 을 02 에 완전히 흡수시켜 archive 로 보내야 한다.
그때까지는 위 표가 지도다.
