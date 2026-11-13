// 점수/티어 설정. 숫자 조정은 이 파일에서만 한다.
module.exports = {
  base: 1000, // 신규 유저 기본 레이팅 (DB 스키마 기본값과 맞춰 둘 것)
  floor: 0, // 레이팅 하한
  win: 25,
  loss: -15,
  bonus: {
    survived: 5, // 끝까지 생존
    policeHit: 5, // 경찰이 마피아를 찾아낼 때마다
    doctorSave: 5, // 의사 세이브 성공 1회당
    mafiaNotExecutedWin: 5, // 마피아가 투표로 처형되지 않고 승리
  },
  leavePenalty: -10, // 게임 도중 이탈: 패배 처리(loss) + 추가 패널티

  // 어뷰징 방지: 아래 조건이면 랭킹에 반영하지 않는다 (이탈자 패널티는 그대로 적용)
  minPlayers: 4,
  maxLeaverRatio: 0.5, // 이탈자가 전체의 이 비율을 "넘으면" 미반영

  // 티어: min 이상 ~ 다음 티어 min 미만. 오름차순.
  tiers: [
    { key: 'thug', name: '똘마니', min: 0 },
    { key: 'hoodlum', name: '건달', min: 1100 }, // 가입 시작 점수(1000)가 똘마니 구간에 들어오도록 기준을 잡았다
    { key: 'enforcer', name: '행동대장', min: 1250 },
    { key: 'capo', name: '간부', min: 1400 },
    { key: 'boss', name: '보스', min: 1600 },
    { key: 'godfather', name: '대부', min: 1800 },
  ],
};
