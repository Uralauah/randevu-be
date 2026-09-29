// 네이버 지역·블로그 검색 API 스텁. 60~150ms 지연 후 고정 형식의 결과를 돌려주고,
// 들어온 호출 수·최대 동시 호출 수·1초 창 최대 호출 수를 기록한다. (429는 흉내 내지 않는다)
const http = require('http');
const port = Number(process.env.STUB_PORT ?? 3990);

let inFlight = 0;
let maxInFlight = 0;
let total = 0;
const arrivals = [];

const items = (query) =>
  Array.from({ length: 5 }, (_, i) => ({
    title: `<b>${query}</b> ${i}`,
    link: `https://map.naver.com/p/place/${Math.floor(Math.random() * 1e9)}`,
    category: '음식점 > 양식',
    description: '데이트하기 좋은 곳',
    telephone: '',
    address: '서울 강남구',
    roadAddress: `서울 강남구 테스트로 ${i}`,
    mapx: String(Math.round(127.0 * 1e7 + Math.random() * 1e5)),
    mapy: String(Math.round(37.5 * 1e7 + Math.random() * 1e5)),
    // 블로그 응답 필드
    bloggername: 'b',
    bloggerlink: '',
    postdate: '20260920',
  }));

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');

    if (url.pathname === '/__stats') {
      let maxPerSecond = 0;
      for (let i = 0, j = 0; i < arrivals.length; i++) {
        while (arrivals[i] - arrivals[j] >= 1000) j++;
        maxPerSecond = Math.max(maxPerSecond, i - j + 1);
      }
      res.end(JSON.stringify({ total, maxInFlight, maxPerSecond }));
      return;
    }

    if (url.pathname === '/__reset') {
      total = 0;
      maxInFlight = 0;
      arrivals.length = 0;
      res.end('ok');
      return;
    }

    total++;
    arrivals.push(Date.now());
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(
      () => {
        inFlight--;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ items: items(url.searchParams.get('query') ?? '') }));
      },
      60 + Math.random() * 90,
    );
  })
  .listen(port, () => console.log(`naver stub on ${port}`));
