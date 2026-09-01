import labWide from './assets/lab_wide_establishing.png'
import labBench from './assets/lab_student_at_bench.png'
import labOts from './assets/lab_student_ots.png'
import labWriting from './assets/lab_writing_erasing.png'
import labFormula from './assets/lab_pattern_ecu.png'
import labDiscovery from './assets/lab_discovery_cu.png'
import labWindow from './assets/lab_window_reveal.png'

// 두 조건은 같은 압축 시놉시스에서 시작한다. 예시를 진행한 뒤에는 아래의
// 기존 씬·샷·패널 자료를 그대로 불러와, 비교 조건의 작업 범위는 바꾸지 않는다.
export const EXAMPLE_STORY = `밤늦은 대학 물리학과 실험실에서 하린은 며칠째 어긋나는 측정 그래프를 반복해 살핀다.

계산과 지우기를 거듭하던 하린은 오차로 보였던 간격이 일정한 규칙임을 발견하고, 새 식을 적어 확신한다.

하린은 노트를 들고 연구동 복도로 나가 불이 켜진 연구실 문 앞에서 잠시 망설이다 노크한다.`

const shots = (scene, rows) => rows.map(([title, description, image], index) => ({
  id: `${scene}-${index + 1}`,
  title,
  description,
  image,
  generatedStyle: 'detailed',
}))

export const EXAMPLE_SCENES = [
  { id: 'example-lab', title: '물리학과 실험실, 밤', sourceText: EXAMPLE_STORY.split('\n\n').slice(0, 2).join(' '), facts: { location: '물리학과 실험실', time: '밤' }, shots: shots('example-lab', [
    ['실험실 전경', '좁고 낡은 대학 실험실. 천장 형광등 하나만 살아 있어 긴 실험대 한쪽에만 빛이 떨어지고, 나머지 공간은 어둠에 잠겨 있다. 오실로스코프와 뒤엉킨 케이블, 비커, 쌓아 올린 출력물이 실험대를 가득 메우고 있다. 창밖에는 비가 내린다.', labWide],
    ['불빛 아래 하린', '하린, 20대 중반의 대학원생. 후드를 입고 머리를 묶은 채 불빛이 닿는 자리에 혼자 앉아 있다. 어두운 장비들 사이에서 그녀는 작아 보인다.', labBench],
    ['측정 그래프', '하린이 노트북 화면을 들여다본다. 화면에는 며칠째 같은 자리에서 어긋나는 측정 그래프가 떠 있다.', labOts],
    ['반복되는 계산', '그녀가 연필로 노트에 식을 적어 내려간다. 몇 줄 쓰다 말고 선을 그어 지운다. 같은 동작이 반복된다.', labWriting],
    ['지친 시선', '하린이 연필을 내려놓고 의자에 등을 기댄다. 지친 얼굴로 천장을 본다.', labBench],
    ['간격을 짚는 손', '시선이 다시 화면으로 내려온다. 어긋난 봉우리들의 간격을 눈으로 짚어 나간다. 손가락이 화면 위를 따라 움직인다.', labOts],
    ['규칙의 발견', '그녀의 손이 멈춘다. 간격이 일정하다. 오차가 아니라 규칙이다.', labFormula],
    ['새 식', '하린이 노트를 끌어당겨 새 줄에 짧은 식 하나를 적는다. 연필 끝이 종이를 누른다.', labWriting],
    ['동그라미 친 식', '그녀가 그 식을 동그라미로 감싼다. 한 번, 두 번, 세 번. 흑연이 종이를 눌러 자국이 팬다.', labFormula],
    ['남은 시도들', '주변에는 지우개 자국과 그어 지운 시도들이 어지럽게 흩어져 있다. 그 한가운데에 방금 적은 식만 또렷하다.', labWriting],
    ['깨달음', '하린이 고개를 든다. 화면 불빛이 아래에서 얼굴을 비춘다. 눈이 화면을 지나 먼 곳에 머문다. 입술이 살짝 벌어진다.', labDiscovery],
    ['정지', '그녀는 움직이지 않는다. 형광등이 한 번 깜빡인다.', labDiscovery],
    ['창가로', '하린이 천천히 일어선다. 의자가 뒤로 밀린다. 노트를 손에 쥔 채 그대로 창가로 걸어간다.', labWindow],
    ['비에 젖은 창', '그녀가 비에 젖은 창 앞에 선다. 유리 너머로 도시의 불빛들이 흩어져 있다. 노트를 든 손이 옆으로 내려간다.', labWindow],
    ['처음 보는 풍경', '하린이 창밖을 본다. 어제까지 보던 것과 같은 풍경이다. 그러나 그녀는 처음 보는 것처럼 서 있다.', labWindow],
  ]) },
  { id: 'example-corridor', title: '연구동 복도, 밤', sourceText: EXAMPLE_STORY.split('\n\n')[2], facts: { location: '연구동 복도', time: '밤' }, shots: shots('example-corridor', [
    ['복도 앞', '불이 반쯤 꺼진 복도. 하린이 노트를 든 채 걸어와 한 연구실 문 앞에 선다.', labWide],
    ['멈춘 손', '문틈으로 불빛이 새어 나온다. 하린이 손을 들었다가 멈춘다.', labDiscovery],
    ['문을 두드리다', '하린이 노트를 내려다본다. 그리고 문을 두드린다.', labWriting],
  ]) },
]

// SceneLens의 DEMO_CAST와 동일한 예시 인물 기준.
export const EXAMPLE_CHARACTERS = [{
  id: 'cast-하린', name: '하린', description: '대학원생 · 여성, 20대 중반 · 묶은 머리, 후드, 마른 체형', image: labDiscovery,
}]
