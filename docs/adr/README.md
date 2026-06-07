# Architecture Decision Records

설계 판단을 누적 기록. 포맷은 [Michael Nygard 스타일](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## 작성 기준

CLAUDE.md "설계 판단 기록 — ADR" 섹션 참조. 다음 중 2개 이상이면 작성:

- 되돌리기 어렵다 (여러 파일·문서·외부 시스템 동시 변경 필요)
- 대안이 있었다 (트레이드오프 존재)
- 장기 영향이 크다 (6개월 뒤에도 참조)
- 온보딩에서 설명이 필요하다
- 판단 근거가 비자명하다

## 작성 방법

1. `template.md` 복사 → `NNNN-<kebab-case>.md` (4자리 zero-padded)
2. 본문 작성, Status는 `Accepted` 로 시작
3. 채택 후에는 본문 수정 X (오탈자/링크만 예외). 판단이 바뀌면 새 ADR + 기존을 `Superseded by ADR-NNNN`

## 인덱스

| 번호 | 제목 | Status | 관련 이슈 |
|------|------|--------|----------|
| [0001](./0001-visit-pickup-dispatch.md) | 방문택배 자동 발송처리 — 폴링 트리거 + 마스킹 매칭 | Accepted | #59 |
| [0002](./0002-sender-via-addressbook-name.md) | 발송인은 GS 주소록 이름 매칭으로 설정 | Accepted | #64 |
