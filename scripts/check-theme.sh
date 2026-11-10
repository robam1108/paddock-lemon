#!/usr/bin/env bash
# 원본 콘셉트의 잔재 용어가 남아 있는지 검사한다. 결과가 0건이어야 통과(exit 0).
# 사용: bash scripts/check-theme.sh            # 저장소 전체
#       bash scripts/check-theme.sh src        # 특정 경로만
set -u
cd "$(dirname "$0")/.."
PATTERN='K-77|병동|가축|배급소|밀거래|수감|죄수|교정|무간|흑색구역|백색구역|진정함|수용|담배|약물|의약품|윤태강|징벌'
if [ "$#" -eq 0 ]; then set -- .; fi
if git grep -nE "$PATTERN" -- "$@" ':!docs/PLAN.md' ':!scripts/check-theme.sh'; then
  echo "check-theme: 금지어가 남아 있습니다." >&2
  exit 1
fi
echo "check-theme: OK"
exit 0
