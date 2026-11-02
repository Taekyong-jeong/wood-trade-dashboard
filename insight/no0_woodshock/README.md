# WIDI 변동 해설 No.0 (샘플) — 2021 우드쇼크 제재목 수입단가 분석 코드·자료

회원 전용 해설의 분석 재현용 코드와 가공 자료. 해설 본문(해석)은 여기 두지 않음.

## 자료 (data/)
| 파일 | 내용 | 원천 |
|---|---|---|
| merged2.csv | 월별 HS 4407 수입단가 P(USD/kg)·중량 Q(톤) + WPU0811·EXKOUS·HOUST·GSCPI·EU 제재업 PPI·캐나다 생산/재고·건설기성 | 관세청(data/raw), FRED, 뉴욕 연준, Eurostat, StatCan, KOSIS |
| domestic.csv | 한국은행 생산자물가(제재목·원목·합판·목재용기·공산품), 수입물가(제재목 원화·달러·계약통화), 목재 및 나무제품 내수출하지수 | KOSIS (data/external/kosis_domestic.json) |
| construction.csv | 건축 착공 연면적(전체·주거·목조), 월 | KOSIS DT_MLTM_6905 |
| japan.csv | 일본 화이트우드 집성관주 출하가(엔/개)·미송 평각(엔/㎥), 전국 | e-Stat 木材統計 (data/external/estat_wood_price.json) |
| comtrade.csv / exporter_uv.csv | 중국·일본·한국의 러시아산 수입, 유럽 수출국 수출단가 | UN Comtrade |
| extra4.csv | 피셔 연쇄 가격지수(FISHER), 가중 유럽 가격(EUW) | 계산값 |
| fx2526.csv | 원/달러 2024.12~2026.09 | FRED EXKOUS |
| fred.json | WPU0811·EXKOUS·HOUST·GSCPI 2016~2024 | FRED, 뉴욕 연준 |

금리·공사비: data/external/kosis_rates.json (주택담보대출 금리 DT_121Y006, 건설공사비지수 DT_39701_A003)

## 코드 (scripts/)
- calc*.py: HS 4407 국가별 집계, LMDI 요인 분해
- stats.py~stats6.py: 시차 회귀(Newey-West), 그레인저, 공적분, 유럽 가격·피셔 지수·사전 예측, 수입량 모형
- stats7.py~stats8.py: 수입단가 → 국내 제재목 생산자물가 전이(비대칭 포함)
- stats9.py: 수입량 + 국내 출하 + 정책 사건
- stats10.py~stats11.py: 수입가격 → 수입량, 목재값·금리·공사비 → 착공
(경로는 작성 당시 작업 폴더 기준이라 실행 전 data/ 경로로 바꿔야 함)
