// 앱의 네이버 검색 API 호출만 로컬 스텁으로 돌린다(node --require로 주입). 앱 코드는 그대로다.
const original = globalThis.fetch;
const stub = `http://127.0.0.1:${process.env.STUB_PORT ?? 3990}`;

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;

  if (url.startsWith('https://openapi.naver.com/v1/search/')) {
    return original(url.replace('https://openapi.naver.com', stub), init);
  }

  return original(input, init);
};
