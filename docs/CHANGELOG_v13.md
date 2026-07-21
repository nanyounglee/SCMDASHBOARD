# SCM 대시보드 변경 내역 공유용

팀 공유 요청에 맞춘 변경 기록 파일입니다. 현재 저장소의 최신 문서는 `docs/CHANGELOG_v22.md`, `docs/SCM_DASHBOARD_사용자가이드_v22.html`, `docs/SCM_DASHBOARD_로직설명_v22.html`가 기준입니다.

## 2026.07.21 구매전략 재고운영 기능 보강
- 입고예정금액: `raw_발주.csv` 미입하 발주와 `parts_master.csv` 표준원가를 연결해 `발주지시수량 × 표준원가`로 계산하고 상세 모달을 추가했습니다.
- 신제품 재고비중: `dashboard_group_summary.csv`, `dashboard_sku_snapshot.csv`의 신제품/초도발주 플래그를 사용해 신제품 재고비중, 초도발주, 재발주완료, 초도 예외를 표시합니다.
- 시즌별 재고회전율: `group_type=season`, `season_type` 기준으로 여름/겨울/봄가을별 재고금액, SKU 수, 1M/3M/YTD 회전율을 표시합니다.
- 수동 업로드 자동인식: `dashboard_sku_detail.csv`, `dashboard_sku_monthly.csv`, `raw_발주.csv`, `parts_master.csv`도 드래그 업로드 시 자동 인식되도록 보강했습니다.
- CSV 헤더 변경: 기존 원본 헤더명 변경은 없습니다. 신규 기능이 의존하는 주요 헤더는 `raw_발주.csv`의 `입하여부`, `재고귀속파츠번호`, `발주지시수량`, `입하예정일`, `parts_master.csv`의 `표준원가`, `dashboard_sku_snapshot.csv`의 `is_new_product`, `is_first_order`, `season_type`, `dashboard_group_summary.csv`의 `group_type`, `group_name`, `turnover_3m`입니다.
