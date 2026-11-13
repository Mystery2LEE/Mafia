// 게임/방 설정값. 숫자 조정은 이 파일에서만 한다.
module.exports = {
  limits: {
    minPlayers: 4,
    maxPlayers: 12,
    titleMax: 30,
    passwordMax: 20,
    // 소켓이 끊긴 뒤 이 시간 안에 재접속하면 같은 방으로 복구, 지나면 방에서 제거
    waitingGraceMs: 10_000,
    ingameGraceMs: 60_000,
    phaseSec: { min: 5, max: 180 },
    // 방 설정과 무관하게 고정인 페이즈 길이(초)
    fixedSec: { roleReveal: 5, morning: 5, execution: 5 },
    // 1초가 몇 ms인가. 테스트에서 줄여서 타이머를 빠르게 돌린다.
    secondMs: 1000,
    // 채팅 도배 방지: perMs 동안 count개까지
    chatRate: { count: 5, perMs: 3000 },
    // 첫날 낮에 처형 투표를 할지. false 면 첫날은 토론만 하고 바로 밤으로 넘어간다 (정보가 없을 때의 무작위 처형 방지)
    firstDayVote: false,
    // 방 생성 시 바꿀 수 있는 게임 옵션의 기본값
    options: { doctorSelfProtect: true },
  },
  // 페이즈 기본 시간(초)
  defaultTimes: { night: 30, discussion: 90, vote: 30, defense: 20, verdict: 15 },

  defaultMafia,
  maxMafia,
  roleCounts,
};

// 인원별 기본 마피아 수: 4–5명 1 / 6–8명 2 / 9–12명 3
function defaultMafia(n) {
  return n <= 5 ? 1 : n <= 8 ? 2 : 3;
}

// 방에서 고를 수 있는 마피아 수의 상한: 인원 ÷ 3 (내림), 최소 1. 마피아가 너무 많으면 시작하자마자 기울어진다.
function maxMafia(n) {
  return Math.max(1, Math.floor(n / 3));
}

// 직업 배분: 경찰·의사 각 1, 나머지 시민. mafia 를 주면 기본값 대신 그 수를 쓴다.
function roleCounts(n, mafia) {
  const m = mafia ?? defaultMafia(n);
  return { mafia: m, police: 1, doctor: 1, citizen: n - m - 2 };
}
