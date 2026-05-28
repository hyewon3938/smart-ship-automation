import { describe, expect, it } from "vitest";

import {
  extractVisitReservationNos,
  parseVisitDetailPage,
} from "./scrape-visit-pickup";

// 예약list 페이지 fixture — 사용자가 제공한 실제 HTML 기반
const LIST_HTML_VISIT_ONLY = `
<table>
  <tbody>
    <tr style="height:125px;">
      <td></td>
      <td>374</td>
      <td>
        <a class="bookingNum" href="javascript:" onclick="commonCtrl.setViewPage('detailsKey', '12148215251', '/my-page/reservation/visit/view.do')">12148215251</a>
      </td>
      <td>방문</td>
      <td>리뷰어 발송</td>
      <td>2026-05-27</td>
      <td>9</td>
      <td>
        <div class="waybillNum">
          <a href="javascript:" class="num">698248901021</a>
        </div>
        <div class="waybillNum">
          <a href="javascript:" class="num">698248901721</a>
        </div>
      </td>
      <td>결제</td>
      <td>
        <a href="javascript:" class="org3 btnConfirmTurnstile">다시예약</a>
      </td>
    </tr>
  </tbody>
</table>
`;

const LIST_HTML_MIXED = `
<table>
  <tbody>
    <tr>
      <td></td>
      <td>373</td>
      <td>
        <a class="bookingNum" href="javascript:">11952684971</a>
      </td>
      <td>국내</td>
      <td>일반 예약</td>
      <td>2026-05-26</td>
      <td>1</td>
      <td><div class="waybillNum"><a class="num">363172788124</a></div></td>
      <td>결제</td>
      <td></td>
    </tr>
    <tr>
      <td></td>
      <td>374</td>
      <td>
        <a class="bookingNum" href="javascript:">12148215251</a>
      </td>
      <td>방문</td>
      <td>리뷰어 발송</td>
      <td>2026-05-27</td>
      <td>9</td>
      <td><div class="waybillNum"><a class="num">698248901021</a></div></td>
      <td>결제</td>
      <td></td>
    </tr>
    <tr>
      <td></td>
      <td>375</td>
      <td>
        <a class="bookingNum" href="javascript:">12148215999</a>
      </td>
      <td>내일</td>
      <td>내일배송</td>
      <td>2026-05-27</td>
      <td>1</td>
      <td><div class="waybillNum"><a class="num">698248901999</a></div></td>
      <td>결제</td>
      <td></td>
    </tr>
  </tbody>
</table>
`;

const LIST_HTML_NO_VISIT = `
<table>
  <tbody>
    <tr>
      <td></td><td>373</td>
      <td><a class="bookingNum">11952684971</a></td>
      <td>국내</td>
      <td>일반</td><td>2026-05-26</td><td>1</td>
      <td><div class="waybillNum"><a class="num">363172788124</a></div></td>
      <td>결제</td><td></td>
    </tr>
  </tbody>
</table>
`;

// 상세페이지 fixture — 사용자가 제공한 실제 HTML 기반
const DETAIL_HTML_SINGLE = `
<div style="display:flex;align-items: stretch;">
  <div class="delMInfo " style="display:inline-block;width:857px;">
    <p class="name">문*진</p>
    <div class="infoDiv">
      <p class="txt1">Address</p>
      <p class="txt2"><span>[47180]</span> 부산광역시 부산진구 당감로25번길 19&nbsp;******************</p>
    </div>
    <div class="infoDiv">
      <p class="txt1">Tel</p>
      <p class="txt2 phone">010-****-5655</p>
    </div>
    <div class="infoDiv">
      <p class="txt1 nbFt">운송장번호</p>
      <p class="txt2"><a href="/reservation-inquiry/delivery/index.do?dlvry_type=domestic&amp;invoice_no=698248901021" class="num" onclick="commonCtrl.startAjax()">698248901021</a></p>
    </div>
    <div class="infoDiv">
      <p class="txt1 nbFt">중량/규격/운임</p>
      <p class="txt2">2.0kg / 80cm / 3,050원</p>
    </div>
  </div>
</div>
`;

const DETAIL_HTML_MULTI = `
<div>
  <div class="delMInfo" style="display:inline-block;width:857px;">
    <p class="name">김*수</p>
    <div class="infoDiv"><p class="txt1">Address</p>
      <p class="txt2"><span>[06236]</span> 서울 강남구 ******</p></div>
    <div class="infoDiv"><p class="txt1">Tel</p>
      <p class="txt2 phone">010-****-1234</p></div>
    <div class="infoDiv"><p class="txt1 nbFt">운송장번호</p>
      <p class="txt2"><a class="num">698200000001</a></p></div>
  </div>
  <div class="delMInfo " style="display:inline-block;width:857px;">
    <p class="name">이*영</p>
    <div class="infoDiv"><p class="txt1">Address</p>
      <p class="txt2"><span>[13494]</span> 경기도 성남시 ******</p></div>
    <div class="infoDiv"><p class="txt1">Tel</p>
      <p class="txt2 phone">010-****-9999</p></div>
    <div class="infoDiv"><p class="txt1 nbFt">운송장번호</p>
      <p class="txt2"><a class="num">698200000002</a></p></div>
  </div>
  <div class="delMInfo" style="display:inline-block;width:857px;">
    <p class="name">박*철</p>
    <div class="infoDiv"><p class="txt1">Address</p>
      <p class="txt2"><span>[47180]</span> 부산광역시 ******</p></div>
    <div class="infoDiv"><p class="txt1">Tel</p>
      <p class="txt2 phone">010-****-5655</p></div>
    <div class="infoDiv"><p class="txt1 nbFt">운송장번호</p>
      <p class="txt2"><a class="num">698200000003</a></p></div>
  </div>
</div>
`;

// 마스킹 변형: asterisk 개수가 4가 아닌 케이스 (4 이상 보장)
const DETAIL_HTML_MASK_VARIANT = `
<div class="delMInfo">
  <p class="txt2"><span>[12345]</span> 어딘가</p>
  <p class="txt2 phone">010-********-7890</p>
  <p class="txt2"><a class="num">123456789012</a></p>
</div>
`;

// 우편번호 누락 블록 → skip
const DETAIL_HTML_MISSING_ZIP = `
<div class="delMInfo">
  <p class="txt2">우편번호 없는 주소</p>
  <p class="txt2 phone">010-****-1111</p>
  <p class="txt2"><a class="num">111111111111</a></p>
</div>
<div class="delMInfo">
  <p class="txt2"><span>[99999]</span> 정상 블록</p>
  <p class="txt2 phone">010-****-2222</p>
  <p class="txt2"><a class="num">222222222222</a></p>
</div>
`;

describe("extractVisitReservationNos", () => {
  it("방문 행만 1건 추출한다", () => {
    expect(extractVisitReservationNos(LIST_HTML_VISIT_ONLY)).toEqual([
      "12148215251",
    ]);
  });

  it("국내/내일/방문 혼재 시 방문 행만 추출한다", () => {
    expect(extractVisitReservationNos(LIST_HTML_MIXED)).toEqual([
      "12148215251",
    ]);
  });

  it("방문 행이 없으면 빈 배열을 반환한다", () => {
    expect(extractVisitReservationNos(LIST_HTML_NO_VISIT)).toEqual([]);
  });

  it("tbody가 없으면 빈 배열을 반환한다", () => {
    expect(extractVisitReservationNos("<html><body></body></html>")).toEqual(
      [],
    );
  });
});

describe("parseVisitDetailPage", () => {
  it("수령인 1명을 정확히 추출한다", () => {
    const result = parseVisitDetailPage(DETAIL_HTML_SINGLE);
    expect(result).toEqual([
      { zipCode: "47180", phoneLast4: "5655", trackingNo: "698248901021" },
    ]);
  });

  it("수령인 N명(3명)을 순서대로 추출한다", () => {
    const result = parseVisitDetailPage(DETAIL_HTML_MULTI);
    expect(result).toEqual([
      { zipCode: "06236", phoneLast4: "1234", trackingNo: "698200000001" },
      { zipCode: "13494", phoneLast4: "9999", trackingNo: "698200000002" },
      { zipCode: "47180", phoneLast4: "5655", trackingNo: "698200000003" },
    ]);
  });

  it("우편번호가 없는 블록은 skip 하고 정상 블록만 추출한다", () => {
    const result = parseVisitDetailPage(DETAIL_HTML_MISSING_ZIP);
    expect(result).toEqual([
      { zipCode: "99999", phoneLast4: "2222", trackingNo: "222222222222" },
    ]);
  });

  it("마스킹 asterisk 개수가 달라도 끝 4자리를 추출한다", () => {
    const result = parseVisitDetailPage(DETAIL_HTML_MASK_VARIANT);
    expect(result).toEqual([
      { zipCode: "12345", phoneLast4: "7890", trackingNo: "123456789012" },
    ]);
  });

  it("delMInfo 블록이 없으면 빈 배열을 반환한다", () => {
    expect(parseVisitDetailPage("<html><body></body></html>")).toEqual([]);
  });
});
