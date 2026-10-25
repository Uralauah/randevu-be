import { stripHtml } from './places.util';

describe('stripHtml', () => {
  it('태그를 지우고 HTML 엔티티를 원래 문자로 되돌린다', () => {
    expect(
      stripHtml(
        '<b>성수</b> 카페 &amp; 베이커리 &quot;오픈&quot; &#39;팝업&#39;',
      ),
    ).toBe('성수 카페 & 베이커리 "오픈" \'팝업\'');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(stripHtml('  <b>카페</b>  ')).toBe('카페');
  });

  it('엔티티로 쓴 꺾쇠는 태그로 오해하지 않고 글자로 남긴다', () => {
    expect(stripHtml('A &lt;b&gt; B')).toBe('A <b> B');
  });
});
