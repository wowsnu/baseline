import { useEffect, useRef, useState } from 'react'
import { EXAMPLE_CHARACTERS, EXAMPLE_SCENES, EXAMPLE_STORY } from './exampleData.js'
import {
  logEdit, logEvent, summarize, exportLog, resetLog,
  condition, setCondition, conditionOrder, setConditionOrder,
  phase, startTask, endTask, uploadedAt, markUploaded, exportedAt,
} from './studyLog.js'
import detailedStyle from './assets/style-anchors/lab-detailed-storyboard.png'
import photorealStyle from './assets/style-anchors/lab-photoreal-previz.png'

const STORAGE_KEY = 'scenelens-baseline-v1'
const uid = (prefix) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

function factsFromHeading(heading = '') {
  const [location = '', time = ''] = heading.split(',').map((part) => part.trim())
  return { location, time }
}

// SceneLens의 buildCutPrompt와 같은 방식으로, 샷 설명 앞에 장소·샷 크기·앵글을
// 문장으로 조립한다. Baseline에는 Lens·이음새·레이아웃 같은 추가 판단값이 없으므로
// 사용자가 고른 기본 샷 정보만 넣는다.
const BASELINE_SHOT_SIZE = {
  'Extreme Wide Shot': '와이드 샷, 공간 전체가 보인다',
  'Wide Shot': '와이드 샷, 공간 전체가 보인다',
  'Full Shot': '풀 샷, 인물 전신이 들어온다',
  'Medium Shot': '미디엄 샷, 상반신 위주',
  'Medium Close-Up': '바스트 샷, 가슴 위로',
  'Close-Up': '클로즈업, 얼굴이 화면을 채운다',
  'Extreme Close-Up': '익스트림 클로즈업, 부분만 크게',
}
const BASELINE_ANGLE = {
  'High Angle': '하이 앵글, 카메라가 위에서 내려다본다',
  'Low Angle': '로 앵글, 카메라가 아래에서 올려다본다',
  'OTS (Over the Shoulder)': '오버 더 숄더, 다른 인물의 어깨 너머로 본다',
  'POV (Point of View)': 'POV, 카메라가 인물의 눈이다 — 그 인물이 보는 것만 화면에 담고 그 인물 자신은 화면에 넣지 않는다(손이나 몸 일부는 허용)',
  'Top-Down / Overhead': '버드 아이, 카메라가 수직으로 내려다본다',
}

const hasFinalConsonant = (text = '') => {
  const last = (text || '').trim().slice(-1)
  if (!last) return false
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 !== 0
}

// 샷 문장이 이름이 아니라 역할어로 인물을 부를 때의 대비책이다
// ("주인공이 앞사람을 제친다"). 그대로 프롬프트에 쓰면 뒤에 붙는 인물
// 목록("화면에는 민준이 보인다")과 같은 사람을 가리키는지 알 수 없어,
// 레퍼런스를 물려도 다른 사람이 그려진다.
//
// 구조화 프롬프트가 lines의 text에도 이름을 쓰라고 지시하므로 보통은
// 바꿀 것이 없다. 모델이 역할어로 돌려줄 때만 이 치환이 걸린다 —
// 이미 이름이 있는 문장은 건드리지 않는다.
// 인물을 가리키지 않는 흔한 말. 이걸 역할어로 잡으면 문장이 망가진다.
const ROLE_STOPWORDS = new Set([
  '남성', '여성', '남자', '여자', '사람', '인물', '대', '중반', '초반', '후반',
  '머리', '체형', '복장', '옷', '살', '세', '정도', '및', '그리고',
])
const nameByRole = (characters = []) => {
  const claims = new Map()
  characters.forEach((character) => {
    const name = (character?.name || '').trim()
    if (!name) return
    // description은 `주인공 러너 · 여성, 20대 중반 · 후드` 같은 모양이다.
    // 첫 조각이 역할이고, 뒤는 외형·나이라 인물을 가리키지 않는다.
    const role = String(character.description || '').split(/[·|,、]/)[0].trim()
    if (!role) return
    // 역할 구절 전체(`앞 러너`)와, 그 안의 낱말(`주인공`)을 모두 후보로
    // 둔다. 구절이 먼저 맞으면 낱말까지 갈 일이 없다.
    const candidates = new Set([role, ...role.split(/\s+/)])
    candidates.forEach((word) => {
      const token = word.trim()
      if (token.length < 2 || ROLE_STOPWORDS.has(token) || token === name) return
      // 두 인물이 같은 말을 쓰면(`러너`) 누구인지 정할 수 없다. 표시만
      // 해 두고 아래에서 뺀다 — 잘못 바꾸느니 역할어로 두는 편이 낫다.
      claims.set(token, claims.has(token) && claims.get(token) !== name ? null : name)
    })
  })
  return [...claims.entries()]
    .filter(([, name]) => Boolean(name))
    // 긴 역할어부터 바꾼다. `앞 러너`를 `러너`가 먼저 먹지 않게.
    .sort((left, right) => right[0].length - left[0].length)
}

const withCharacterNames = (text = '', characters = []) => (
  nameByRole(characters).reduce((line, [role, name]) => (
    line.includes(name) ? line : line.split(role).join(name)
  ), text)
)

function buildBaselinePanelPrompt(shot, scene, characters = []) {
  if (!shot) return ''
  const isPov = shot.perspective === 'POV (Point of View)' || shot.perspective === 'POV'
  const angle = BASELINE_ANGLE[shot.perspective] || (shot.perspective && shot.perspective !== 'Eye Level' ? shot.perspective : '')
  const size = BASELINE_SHOT_SIZE[shot.shotSize] || shot.shotSize || ''

  // 1문장: 장소·시간, 앵글, 샷 크기
  const place = scene?.title || scene?.facts?.location || ''
  const opening = [
    place && `${place}.`,
    angle && `${angle}.`,
    !isPov && size && `${size}.`,
  ].filter(Boolean).join(' ')

  // 2문장: 행동 및 대사 처리. 역할어는 인물 이름으로 바꿔 아래 인물
  // 목록과 같은 사람을 가리키게 한다.
  // `@`는 감독이 인물을 짚는 우리 문법이지 그림에 대한 지시가 아니다.
  // 그대로 두면 이미지 모델이 낯선 기호를 지시로 오해하거나 화면에 글자로
  // 그린다. 인물은 아래 castLine이 따로 말하므로 여기서 뗀다. 낱말 앞에
  // 붙은 것만 뗀다 — `a@b.com`은 멘션이 아니라 원문의 일부다.
  const rawText = withCharacterNames(
    (shot.description || shot.title || '').trim().replace(/(^|[\s([{'"])@(?=[^\s@,，.。!?…])/g, '$1'),
    characters,
  )
  let action = ''
  if (rawText) {
    const speechMatch = rawText.match(/^(.*?)(?:[:：]\s*|\s+말한다\s*[:：]?\s*|\s*["“])([^"”]+)["”]?$/)
    if (speechMatch && speechMatch[2]) {
      const speaker = (speechMatch[1] || '').trim()
      const dialogue = (speechMatch[2] || '').trim()
      action = speaker
        ? `${speaker}${hasFinalConsonant(speaker) ? '이' : '가'} "${dialogue}"라고 말하는 순간이다.`
        : `누군가 "${dialogue}"라고 말하는 순간이다.`
    } else {
      action = `${rawText.replace(/[.。]\s*$/, '')}.`
    }
  }

  // 3문장: 인물 및 POV 처리 (SceneLens와 동일: POV 시 대상 인물 숨김 명시)
  const mentioned = charactersForShot(shot, characters)

  let castLine = ''
  if (isPov) {
    const povChar = mentioned[0] || characters[0]
    if (povChar?.name) {
      castLine = `이 화면은 ${povChar.name}의 시점(POV)이다. ${povChar.name} 자신은 화면에 보이지 않는다.`
    }
  } else if (mentioned.length > 0) {
    const names = mentioned.map((c) => c.name).join(', ')
    castLine = `화면에는 ${names}${hasFinalConsonant(names) ? '이' : '가'} ${mentioned.length > 1 ? '함께 ' : ''}보인다. 이 목록에 없는 사람은 화면에 넣지 않는다.`
  }

  return [opening, action, castLine].filter(Boolean).join(' ')
}

// 이름 뒤에 붙는 조사. `@하린이`, `@민준과`처럼 문장으로 쓴 것을 이름으로
// 되돌리는 데 쓴다.
const PARTICLES = ['이가', '에게서', '한테서', '으로', '에게', '한테', '이랑', '와의', '과의',
  '은', '는', '이', '가', '을', '를', '의', '도', '만', '과', '와', '랑', '에']
const stripParticle = (token = '') => {
  for (const particle of PARTICLES) {
    if (token.length > particle.length && token.endsWith(particle)) {
      return token.slice(0, -particle.length)
    }
  }
  return token
}

// 샷 설명에 쓴 `@이름` 하나를 실제 인물로 푼다.
//
// **이름 전체를 적어야 물린다.** `@하`처럼 줄여 쓴 것은 `하린`이 아니다 —
// 줄임을 받아 주면 오타가 조용히 다른 인물로 물리고, 인물이 늘어난 뒤에
// 같은 글자가 갑자기 다른 사람을 가리키게 된다. 못 찾으면 그 사실을
// 밝혀서 감독이 그 자리에서 고치게 한다.
//
// 조사는 문장으로 쓴 것이므로 받아 준다 — `@하린이 본다`의 `하린이`는
// 줄여 쓴 것이 아니라 이름에 조사가 붙은 것이다.
export function resolveMention(token, characters = []) {
  const names = (characters || []).map((character) => character?.name).filter(Boolean)
  const match = (value) => {
    const exact = names.find((name) => name === value)
    if (exact) return exact
    // `@하린이`처럼 이름 뒤에 문장이 이어 붙은 경우. 이름으로 **시작**해야
    // 한다 — 이름의 일부만 적은 것은 여기에 걸리지 않는다.
    return names.filter((name) => value.startsWith(name))
      .sort((left, right) => right.length - left.length)[0] || null
  }
  const bare = stripParticle(token)
  const direct = match(token) || (bare !== token ? match(bare) : null)
  if (direct) return { token, name: direct, matched: true, exact: true }
  // 줄여 쓴 것으로 보이면 무엇을 적어야 하는지 알려 준다. 물리지는 않는다.
  const partial = names.filter((name) => name.startsWith(bare))
  return { token, name: null, matched: false, ambiguous: partial.length > 0, options: partial }
}

export function mentionsOfShot(shot, characters = []) {
  const rawText = `${shot?.description || ''} ${shot?.title || ''}`
  const tokens = [...rawText.matchAll(/@([^\s@,，.。!?…]+)/g)]
    .map((match) => match[1].trim())
    .filter((token, index, all) => token && all.indexOf(token) === index)
  return tokens.map((token) => resolveMention(token, characters))
}

function charactersForShot(shot, characters = []) {
  // `@이름`은 AI가 채운 명단을 **덮어쓰지 않고 더한다.** 덮어쓰면 한 명을
  // 강조하려고 `@민준`을 적었을 뿐인데 같은 화면의 도윤이 빠진다.
  const tagged = mentionsOfShot(shot, characters)
    .filter((mention) => mention.matched)
    .map((mention) => mention.name)
  const declaredNames = [...new Set([...(shot?.characters || []), ...tagged])]
  if (!declaredNames.length) return []
  return (characters || []).filter((character) => character?.name && declaredNames.includes(character.name))
}

function buildBaselineReferencePrompt(subject) {
  if (!subject) return { auto: '', effective: '', isEdited: false }
  const name = subject.name || ''
  const settled = (subject.facts || [])
    .filter((fact) => !fact?.open && fact?.value)
    .map((fact) => fact.value)
  const head = subject.summary && subject.summary !== name
    ? [name, subject.summary]
    : [name]
  if (!subject.summary && subject.description) settled.unshift(subject.description)
  const auto = [...head, ...settled].filter(Boolean).join('. ')
  const edited = subject.promptOverride || ''
  return {
    auto,
    effective: edited.trim() ? edited : auto,
    isEdited: Boolean(edited.trim()),
  }
}

async function referenceImageBase64(image) {
  if (!image) return ''
  const [, data] = image.split(',', 2)
  if (image.startsWith('data:')) return data || ''
  if (!image.includes('/')) return image
  try {
    const response = await fetch(image)
    if (!response.ok) return ''
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch { return '' }
}

function localStructure(story) {
  const lines = (story || '').split(/\n+|(?<=[.!?。])\s+/).map((line) => line.trim()).filter(Boolean)
  return [{
    id: uid('scene'), title: '장면 1', sourceText: story || '',
    facts: { location: '', time: '' },
    shots: lines.map((description, index) => ({ id: uid('shot'), title: `샷 ${index + 1}`, description, shotSize: 'Medium Shot', perspective: 'Eye Level', image: null })),
  }]
}

function fromStructure(data, story) {
  return (data?.scenes || []).map((scene, sceneIndex) => {
    const descriptions = (scene?.beats || []).flatMap((beat) => beat?.lines || []).filter((line) => line?.text)
    return {
      id: uid('scene'), title: scene?.heading || `장면 ${sceneIndex + 1}`,
      sourceText: descriptions.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim() || story,
      facts: factsFromHeading(scene?.heading),
      shots: (descriptions.length ? descriptions : [{ text: story, characters: [] }]).map((line, index) => ({
        id: uid('shot'), title: `샷 ${index + 1}`, description: line.text, characters: line.characters || [], shotSize: line.shot_size || 'Medium Shot', perspective: line.perspective || 'Eye Level', image: null,
      })),
    }
  })
}

// `@이름`을 쓴 자리 아래에 실제로 물린 인물을 보여 준다. 적은 글자를
// 그대로 되비추면 `@하`처럼 줄여 썼을 때 적용된 것인지 알 수 없고, 오타로
// 아무도 물리지 않은 경우와 구분되지 않는다.
function MentionBadges({ shot, characters }) {
  const mentions = mentionsOfShot(shot, characters)
  if (mentions.length === 0) return null
  return (
    <div className="mention-badges" aria-label="이 샷에 지정한 인물">
      {mentions.map((mention) => (
        <span
          key={mention.token}
          className={mention.matched ? 'matched' : 'unmatched'}
          title={mention.matched
            ? (mention.exact
              ? `${mention.name}의 기준 그림이 이 샷에 물립니다`
              : `@${mention.token} → ${mention.name}의 기준 그림이 이 샷에 물립니다`)
            : mention.ambiguous
              ? `이름을 끝까지 적어 주세요 — ${mention.options.join(', ')}`
              : '이런 이름의 인물이 없습니다. 캐릭터 목록에 있는 이름으로 적어 주세요.'}
        >
          @{mention.matched ? mention.name : mention.token}
          {mention.matched && !mention.exact && <i>← @{mention.token}</i>}
          {!mention.matched && <i>{mention.ambiguous ? '이름을 끝까지' : '없는 인물'}</i>}
        </span>
      ))}
    </div>
  )
}

function download(name, text, type) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function App() {
  const [story, setStory] = useState(EXAMPLE_STORY)
  const [scenes, setScenes] = useState(EXAMPLE_SCENES)
  // 생성은 await로 이어 달리는데, 그동안 클로저의 scenes는 시작 시점에
  // 멈춰 있다. 앞 샷을 방금 그렸어도 다음 샷이 그 그림을 이웃으로 물지
  // 못하므로, 항상 최신 값을 볼 수 있는 통로를 둔다.
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const [activeSceneId, setActiveSceneId] = useState(EXAMPLE_SCENES[0].id)
  const [activeShotId, setActiveShotId] = useState(EXAMPLE_SCENES[0].shots[0].id)
  const [stage, setStage] = useState('script')
  const [artStyle, setArtStyle] = useState('detailed')
  const [panelImageModel, setPanelImageModel] = useState('gpt-image-2')
  const [characters, setCharacters] = useState(EXAMPLE_CHARACTERS)
  const [characterPending, setCharacterPending] = useState({})
  const [panelPending, setPanelPending] = useState({})
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // 실험 진행 상태. SceneLens와 같은 흐름을 쓴다 — 참가자가 두 조건을
  // 오가므로 조작이 다르면 그 자체가 조건 간 차이가 된다.
  const [studyPhase, setStudyPhase] = useState(() => phase())
  const [uploaded, setUploaded] = useState(() => Boolean(uploadedAt()))
  const [editingShotId, setEditingShotId] = useState(null)
  // Edit을 열 때의 값. 고친 값은 updateShot이 즉시 저장하므로, 무엇이
  // 달라졌는지는 이 스냅샷과 견줘야 알 수 있다. 그 차이를 생성에 함께
  // 보내야 모델이 "이것만 바꾸고 나머지는 그대로"를 지킬 수 있다.
  const [editingShotBefore, setEditingShotBefore] = useState(null)
  const openShotEditor = (shot) => {
    setEditingShotBefore(shot ? { ...shot } : null)
    setEditingShotId(shot?.id || null)
  }
  // 그리지 않고 닫으면 비교 대상도 놓는다. 남겨 두면 나중에 카드에서 그냥
  // 다시 생성했을 때, 그때 고친 것도 아닌 항목이 `이것만 바꿔라`로 나간다.
  const closeShotEditor = () => {
    setEditingShotBefore(null)
    setEditingShotId(null)
  }
  const [previewImage, setPreviewImage] = useState(null)
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || scenes[0]
  const requiredCharacters = (characters || []).filter((character) => character?.name?.trim())
  const referencesReady = requiredCharacters.every((character) => Boolean(character.image))
  const referencesPending = requiredCharacters.some((character) => characterPending[character.id])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (saved?.scenes && Array.isArray(saved.scenes) && saved.scenes.length > 0) {
        setStory(saved.story || '')
        setScenes(saved.scenes.map((scene) => ({
          ...scene,
          shots: (scene.shots || []).map((shot) => ({
            ...shot,
            shotSize: shot.shotSize || 'Medium Shot',
            perspective: shot.perspective || 'Eye Level',
          })),
        })))
        setActiveSceneId(saved.activeSceneId || saved.scenes[0]?.id || null)
        setActiveShotId(saved.activeShotId || null)
        setStage('script')
        setArtStyle(saved.artStyle === 'photoreal' ? 'photoreal' : 'detailed')
        setPanelImageModel(['gpt-image-1', 'gpt-image-2', 'flux-2-klein'].includes(saved.panelImageModel) ? saved.panelImageModel : 'gpt-image-2')
        const rawChars = Array.isArray(saved.characters) ? saved.characters : []
        const validChars = rawChars.filter(Boolean).map((c) => ({
          id: c.id || uid('character'),
          name: c.name || '',
          description: c.description || '',
          image: c.image || null,
        }))
        const isDefaultStory = saved.story?.trim() === EXAMPLE_STORY.trim()
        setCharacters(isDefaultStory ? EXAMPLE_CHARACTERS : validChars)
      }
    } catch { }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated || !scenes.length) return
    try {
      // 대용량 base64 이미지는 localStorage의 5MB 용량 한도를 초과하여
      // 브라우저 런타임 QuotaExceededError 크래시를 유발할 수 있으므로
      // 로컬 스토리지에는 텍스트/메타데이터 위주로 안전하게 저장한다.
      const safeCharacters = (characters || []).map((c) => ({
        id: c?.id,
        name: c?.name || '',
        description: c?.description || '',
        // static 예시 이미지 경로만 저장하고 수 메가바이트짜리 data:image base64는 제외
        image: (typeof c?.image === 'string' && !c.image.startsWith('data:')) ? c.image : null,
      }))
      const safeScenes = (scenes || []).map((scene) => ({
        ...scene,
        shots: (scene?.shots || []).map((shot) => ({
          ...shot,
          image: (typeof shot?.image === 'string' && !shot.image.startsWith('data:')) ? shot.image : null,
        })),
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        story,
        scenes: safeScenes,
        activeSceneId,
        activeShotId,
        stage,
        artStyle,
        panelImageModel,
        characters: safeCharacters,
      }))
    } catch (e) {
      // localStorage 저장 실패가 앱을 중단시키지 않도록 안전하게 보호
      console.warn('localStorage save skipped:', e)
    }
  }, [story, scenes, activeSceneId, activeShotId, stage, artStyle, panelImageModel, characters, hydrated])

  const updateScene = (sceneId, update) => setScenes((current) => current.map((scene) => (
    scene.id === sceneId ? { ...scene, ...update } : scene
  )))
  const updateShot = (shotId, update) => setScenes((current) => current.map((scene) => ({
    ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, ...update } : shot),
  })))

  /**
   * 글자를 고친 것을 **한 건으로** 센다.
   *
   * textarea는 한 글자마다 onChange가 오므로 그대로 남기면 `설명 수정`
   * 하나가 수백 건이 된다. 같은 샷의 같은 항목을 이어 고치는 동안은
   * 한 번으로 묶고, 손을 뗀 뒤(1.2초)에 남긴다.
   *
   * 층위는 무엇을 고쳤는지에 따라 갈린다 — 설명·제목은 그 칸 안의 일이라
   * `element`, 샷 크기·앵글은 그 컷을 어떻게 찍는가라 `shot`이다.
   */
  const editTimers = useRef({})
  const logShotEdit = (shotId, field) => {
    const level = (field === 'shotSize' || field === 'perspective') ? 'shot' : 'element'
    const key = `${shotId}:${field}`
    clearTimeout(editTimers.current[key])
    editTimers.current[key] = setTimeout(() => {
      logEdit({ level, target: shotId, action: field })
      delete editTimers.current[key]
    }, 1200)
  }
  const createStoryboard = async () => {
    if (!story.trim()) { setNotice('대본을 입력해 주세요.'); return }
    if (story.trim() === EXAMPLE_STORY.trim()) {
      setScenes(EXAMPLE_SCENES); setActiveSceneId(EXAMPLE_SCENES[0].id); setActiveShotId(EXAMPLE_SCENES[0].shots[0].id)
      setCharacters(EXAMPLE_CHARACTERS)
      setStage('review'); setNotice('예시 씬 구성을 확인해 주세요.'); return
    }
    setBusy(true); setNotice('장면을 나누고 내용을 정리하고 있습니다…')
    try {
      const response = await fetch('/api/story/structure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story: story.trim() }),
      })
      if (!response.ok) throw new Error('structure unavailable')
      const structured = await response.json()
      const nextScenes = fromStructure(structured, story.trim())
      setScenes(nextScenes); setActiveSceneId(nextScenes[0]?.id || null); setActiveShotId(nextScenes[0]?.shots[0]?.id || null)
      // 구조화가 성별·나이와 외형까지 뽑아 준다. 역할만 남기고 버리면
      // 레퍼런스 프롬프트가 대본에 있던 사실을 다시 못 쓴다.
      setCharacters((structured.characters || []).map((character) => ({
        id: uid('character'),
        name: character.name,
        description: [character.description, character.gender_age, character.appearance]
          .map((part) => (part || '').trim())
          .filter(Boolean)
          .join(' · '),
        image: null,
      })))
      setStage('review')
      setNotice('장면과 기본 샷을 만들었습니다. 필요한 내용을 직접 편집하세요.')
    } catch {
      const nextScenes = localStructure(story.trim())
      setScenes(nextScenes); setActiveSceneId(nextScenes[0].id); setActiveShotId(nextScenes[0].shots[0]?.id || null)
      setCharacters([])
      setStage('review')
      setNotice('자동 분할 서버에 연결되지 않아 입력 문장으로 기본 샷을 만들었습니다.')
    } finally { setBusy(false) }
  }

  const insertShot = (at) => {
    if (!activeScene) return
    const shot = { id: uid('shot'), title: '새 샷', description: '', shotSize: 'Medium Shot', perspective: 'Eye Level', image: null, inserted: true }
    // 컷 수가 바뀌는 일이므로 `shot`. SceneLens 쪽 삽입·삭제와 같은
    // 칸에 떨어져야 두 조건을 견줄 수 있다 (프로토콜 5.2).
    logEdit({ level: 'shot', target: shot.id, action: 'insert' })
    updateScene(activeScene.id, { shots: [...activeScene.shots.slice(0, at), shot, ...activeScene.shots.slice(at)] })
    setActiveShotId(shot.id)
  }
  const deleteShot = (shotId) => {
    if (!activeScene || activeScene.shots.length <= 1) { setNotice('각 장면에는 샷 한 장 이상이 필요합니다.'); return }
    logEdit({ level: 'shot', target: shotId, action: 'delete' })
    const index = activeScene.shots.findIndex((shot) => shot.id === shotId)
    const next = activeScene.shots.filter((shot) => shot.id !== shotId)
    updateScene(activeScene.id, { shots: next })
    if (activeShotId === shotId) setActiveShotId(next[Math.min(index, next.length - 1)].id)
  }
  /**
   * 세션을 내보낸다 — 파일과 서버 양쪽으로.
   *
   * 전에는 최종 산출물(story/scenes)만 보냈다. 그러면 무엇을 만들었는지는
   * 남지만 **무엇을 했는지가 없어** 프로토콜 5.2의 조건 비교를 할 수 없다.
   * 이제 행동 로그가 함께 나가고, 형식은 SceneLens 쪽과 같다.
   */
  const exportData = async () => {
    const finalSnapshot = {
      captured_at: new Date().toISOString(),
      story,
      art_style: artStyle,
      scenes: scenes.map((scene, sceneIndex) => ({
        id: scene.id || `scene-${sceneIndex + 1}`,
        title: scene.title || '',
        shots: (scene.shots || []).map((shot, order) => ({
          id: shot.id,
          order: order + 1,
          title: shot.title || '',
          description: shot.description || '',
          shotSize: shot.shotSize || '',
          perspective: shot.perspective || '',
          image: shot.image || null,
        })),
      })),
    }
    const payload = exportLog({ finalSnapshot })
    try {
      const response = await fetch('/api/study/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'baseline',
          participant_id: payload.metadata.session_id,
          condition: payload.metadata.condition,
          payload,
        }),
      })
      if (response.ok) {
        markUploaded()
        setUploaded(true)
        setNotice('내보내기 완료 — 파일 저장됨, 서버에도 올라갔습니다.')
        return
      }
      const detail = await response.text().catch(() => '')
      setNotice(`파일은 저장됐지만 서버 업로드 실패 (${response.status}). ${detail.slice(0, 120)} — JSON 파일을 보관하세요.`)
    } catch (error) {
      setNotice(`파일은 저장됐지만 서버에 연결하지 못했습니다. ${String(error).slice(0, 100)} — JSON 파일을 보관하세요.`)
    }
  }
  const generateCharacterReference = async (character) => {
    if (!character || !character.name || !character.name.trim()) {
      setNotice('캐릭터 이름을 입력해 주세요.')
      return false
    }
    const prompt = buildBaselineReferencePrompt(character).effective || `${character.name}, 스토리보드에 등장하는 인물`
    setCharacterPending((current) => ({ ...current, [character.id]: true }))
    try {
      const response = await fetch('/api/reference-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'character', prompt, style: '', style_preset: artStyle, model: panelImageModel === 'flux-2-klein' ? 'gpt-image-1' : panelImageModel }),
      })
      if (!response.ok) throw new Error('reference image unavailable')
      const data = await response.json()
      setCharacters((items) => (items || []).map((item) => item?.id === character.id ? { ...item, image: `data:image/png;base64,${data.image}` } : item))
      return true
    } catch (err) {
      console.error('generateCharacterReference error:', err)
      setNotice('인물 레퍼런스를 만들지 못했습니다. 백엔드 연결을 확인해 주세요.')
      return false
    } finally {
      setCharacterPending((current) => ({ ...current, [character.id]: false }))
    }
  }
  const prepareStoryboard = async () => {
    setStage('generating')
    const targets = (characters || []).filter((character) => character && character.name && character.name.trim())
    if (!targets.length) {
      setNotice('확인할 캐릭터가 없습니다. 바로 스토리보드 패널로 이동합니다.')
      setStage('panels')
      return
    }
    setBusy(true)
    setNotice('캐릭터 레퍼런스를 생성하고 있습니다…')
    try {
      let failed = false
      for (const character of targets) {
        const success = await generateCharacterReference(character)
        if (!success) failed = true
      }
      setNotice(failed ? '일부 캐릭터 생성을 완료하지 못했습니다. 캐릭터 확인에서 다시 생성할 수 있습니다.' : '캐릭터 레퍼런스가 준비되었습니다. 확인해 주세요.')
    } catch (err) {
      console.error('prepareStoryboard error:', err)
      setNotice('캐릭터 생성 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const enterPanels = () => {
    if (!referencesReady) {
      setNotice('모든 캐릭터 레퍼런스가 준비된 뒤 Panels를 시작할 수 있습니다.')
      setStage('characters')
      return
    }
    setStage('panels')
  }
  // 이번에 무엇만 달라지는가. Edit을 열 때의 값과 견줘 실제로 바뀐 항목만
  // 남긴다. 이 목록이 있어야 모델이 "이것만 고치고 나머지는 그대로"를 지킬
  // 대상을 갖는다 — 최종 값만 받으면 앵글 하나를 바꿔도 자세·소품·구도까지
  // 새로 그려, 감독은 방금 고른 한 가지가 화면에서 무엇을 바꾸는지 못 본다.
  const changesSince = (before, shot) => {
    if (!before || before.id !== shot?.id) return []
    const lines = []
    if (before.shotSize !== shot.shotSize) {
      lines.push(`shot size: ${before.shotSize || '미정'} → ${shot.shotSize || '미정'}`)
    }
    if (before.perspective !== shot.perspective) {
      lines.push(`angle: ${before.perspective || '미정'} → ${shot.perspective || '미정'}`)
    }
    // 설명이 바뀌면 화면 자체가 달라지는 것이라 `이것만`이 성립하지 않는다.
    // 그때는 목록을 비워 처음 그리는 것과 같게 둔다.
    if ((before.description || '') !== (shot.description || '')) return []
    return lines
  }

  const generateShot = async (target) => {
    const shotId = target?.id
    if (!shotId) return
    // 넘겨받은 객체는 눌린 시점의 사본이다. 방금 Edit에서 고친 샷 크기·
    // 앵글·설명을 쓰려면 지금 상태에서 다시 읽어야 한다 — 사본을 그대로
    // 쓰면 고치고 바로 생성했을 때 옛 값으로 그려진다. 여러 샷을 이어
    // 그릴 때 앞 샷의 새 그림을 이웃으로 물리는 것도 같은 이유다.
    const currentScenes = scenesRef.current
    const latestScene = currentScenes.find((entry) => entry.shots?.some((item) => item?.id === shotId))
      || activeScene
    const shot = latestScene?.shots?.find((item) => item?.id === shotId) || target
    const missingCharacters = charactersForShot(shot, characters).filter((character) => !character.image)
    if (missingCharacters.length > 0) {
      setNotice(`${missingCharacters.map((character) => character.name).join(', ')} 레퍼런스를 먼저 생성해 주세요.`)
      setStage('characters')
      return
    }
    // 값 하나만 바꿔 다시 그리는가. Edit을 열 때의 값과 견준다.
    const changes = changesSince(editingShotBefore, shot)
    setPanelPending((current) => ({ ...current, [shot.id]: true }))
    try {
      const scene = latestScene
      const shotIndex = scene?.shots ? scene.shots.findIndex((item) => item?.id === shot.id) : -1
      const previousShot = shotIndex > 0 ? scene.shots[shotIndex - 1] : null
      const nextShot = (shotIndex >= 0 && shotIndex < (scene?.shots?.length || 0) - 1) ? scene.shots[shotIndex + 1] : null

      const shotCharacters = charactersForShot(shot, characters)
      const referenceCharacters = shotCharacters.filter((character) => character.image)

      const styleImage = artStyle === 'photoreal' ? photorealStyle : detailedStyle
      const rawReferences = [
        { name: artStyle === 'photoreal' ? '실사 프리비즈' : '디테일 스케치', kind: 'style', image: styleImage },
        // 이전 샷의 이미지를 연속성(neighbor-before)으로 전달하여 색감/조명/배경 통일
        previousShot?.image && { name: '앞 패널', kind: 'neighbor-before', image: previousShot.image },
        shot.inserted && nextShot?.image && { name: '뒤 패널', kind: 'neighbor-after', image: nextShot.image },
        // 값 하나만 바꾸는 중이면 지금 그림을 함께 물린다. 이 그림이 있어야
        // `나머지는 그대로`가 지킬 대상을 갖는다 — 글로만 유지하라고 하면
        // 무엇을 유지할지 알 수 없다.
        changes.length > 0 && shot.image && { name: '현재 패널', kind: 'current', image: shot.image },
        ...referenceCharacters.map((character) => ({ name: character.name || '인물', kind: 'character', image: character.image })),
      ].filter(Boolean)

      const references = (await Promise.all(
        rawReferences.map(async (reference) => ({
          ...reference,
          image: await referenceImageBase64(reference.image),
        }))
      )).filter((reference) => reference.image)

      const prompt = buildBaselinePanelPrompt(shot, scene, characters)
      const previousPrompt = previousShot ? buildBaselinePanelPrompt(previousShot, scene, characters) : ''

      const response = await fetch('/api/panel-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          shared: scene?.sourceText || scene?.title || '',
          previous: previousPrompt,
          references,
          style: '', style_preset: artStyle, layout: '', changes, model: panelImageModel,
        }),
      })
      if (!response.ok) throw new Error('panel image unavailable')
      const data = await response.json()
      // 재생성 의존도(프로토콜 5.2). 같은 패널을 두 번째 이상 그리면
      // repeat — 그림을 다시 뽑는 것으로 문제를 푸는 쪽에 얼마나
      // 기대는지가 이 값으로 보인다. `이미 그림이 있었나`로 가른다.
      logEvent('panel_generate', { target: shot.id, repeat: Boolean(shot.image) })
      updateShot(shot.id, { image: `data:image/png;base64,${data.image}`, generatedStyle: artStyle, inserted: false })
      // 비교 대상은 이번 한 번에만 쓴다. 남겨 두면 다음 생성이 옛 값과
      // 견줘 바뀌지도 않은 항목을 `이것만 바꿔라`로 보낸다.
      if (editingShotBefore?.id === shot.id) setEditingShotBefore(null)
    } catch (err) {
      console.error('generateShot error:', err)
      setNotice('패널 이미지를 만들지 못했습니다. 백엔드 연결을 확인해 주세요.')
    } finally {
      setPanelPending((current) => ({ ...current, [shot.id]: false }))
    }
  }
  const generateSceneShots = async (targetScene) => {
    const scene = targetScene || activeScene
    if (!scene?.shots) return
    const targetList = scene.shots.filter((shot) => shot && (!shot.image || shot.generatedStyle !== artStyle))
    if (!targetList.length) return
    setNotice(targetList.length + '개 샷의 패널 생성을 시작합니다…')
    for (const shot of targetList) {
      await generateShot(shot)
    }
  }
  useEffect(() => {
    if (stage === 'panels' && activeScene) void generateSceneShots(activeScene)
  }, [stage])
  // 실험 조건은 세션 시작 전에 정해져야 한다. SceneLens와 같은 방식으로
  // 받는다 — 두 조건에서 조작이 다르면 실험자가 헷갈린다.
  //   ?condition=baseline&order=1
  //   Ctrl+Shift+C  조건·순서 입력
  //   Ctrl+Shift+S  과제 시작·종료
  //   Ctrl+Shift+E  내보내기
  //   Ctrl+Shift+R  비우기
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('condition')
    if (fromUrl) setCondition(fromUrl)
    const orderFromUrl = params.get('order')
    if (orderFromUrl) setConditionOrder(orderFromUrl)
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (!event.ctrlKey || !event.shiftKey) return
      if (event.key === 'C' || event.key === 'c') {
        event.preventDefault()
        const next = window.prompt('실험 조건 (baseline / scenelens)', condition())
        if (next) setCondition(next)
        const nextOrder = window.prompt('이 참가자의 몇 번째 조건인가 (1 / 2)', conditionOrder())
        if (nextOrder) setConditionOrder(nextOrder)
      }
      if (event.key === 'S' || event.key === 's') {
        event.preventDefault()
        if (phase() === 'tutorial') {
          startTask(); setStudyPhase(phase())
          window.alert('본 과제를 시작했습니다. 여기부터 측정합니다.')
        } else if (phase() === 'task') {
          if (window.confirm('본 과제를 종료할까요? 이 뒤의 조작은 측정에서 빠집니다.')) {
            endTask(); setStudyPhase(phase())
          }
        } else {
          window.alert('이미 종료된 과제입니다. 다음 참가자는 Ctrl+Shift+R로 비우세요.')
        }
      }
      if (event.key === 'E' || event.key === 'e') {
        event.preventDefault()
        exportData()
      }
      if (event.key === 'R' || event.key === 'r') {
        event.preventDefault()
        const { edits, regeneration } = summarize()
        const ok = window.confirm(
          (exportedAt()
            ? `마지막 내보내기: ${new Date(exportedAt()).toLocaleString('ko-KR')}\n\n`
            : '⚠️ 이 세션은 한 번도 내보내지 않았습니다.\n지우면 기록이 사라집니다.\n\n')
          + `수정 ${edits.total}건, 생성 ${regeneration.total}건의 기록을 지웁니다. 계속할까요?`,
        )
        if (ok) { resetLog(); setStudyPhase(phase()); setUploaded(false) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const loadExample = () => {
    setStory(EXAMPLE_STORY); setScenes(EXAMPLE_SCENES); setStage('script')
    setCharacters(EXAMPLE_CHARACTERS)
    setActiveSceneId(EXAMPLE_SCENES[0].id); setActiveShotId(EXAMPLE_SCENES[0].shots[0].id)
    setNotice('예시 대본과 패널을 불러왔습니다.')
  }

  return <main className="app">
    <header><div><p className="eyebrow">STORYBOARD EDITOR</p><h1>Storyboard</h1></div></header>
    <nav className="progress" aria-label="작업 단계"><span className={stage === 'script' ? 'current' : 'done'}>1. Idea</span><span className={stage === 'review' ? 'current' : ['setup', 'generating', 'characters', 'panels'].includes(stage) ? 'done' : ''}>2. Story</span><span className={['setup', 'generating', 'characters', 'panels'].includes(stage) ? 'current' : ''}>3. Storyboard</span></nav>
    {stage === 'script' && <section className="script-section"><label htmlFor="story">대본</label><textarea id="story" value={story} onChange={(e) => setStory(e.target.value)} placeholder="스토리를 입력하세요. 장소나 시간이 바뀌면 새 장면으로 나뉩니다." /><div className="script-actions"><span>{notice}</span><div><button className="secondary" onClick={loadExample}>예시 대본 불러오기</button> <button onClick={createStoryboard} disabled={busy}>{busy ? '나누는 중…' : '씬 구성 만들기'}</button></div></div></section>}
    {stage === 'review' && <section className="review-section"><div className="review-heading"><div><p className="eyebrow">STORY</p><h2>씬 구성 확인</h2><p>자동으로 나뉘고 보강된 장면입니다. 필요한 내용을 확인한 뒤 Panels로 넘어가세요.</p></div></div><div className="review-scenes">{scenes.map((scene, index) => <article className="review-scene" key={scene.id}><p>SCENE {index + 1}</p><input value={scene.title} aria-label={`장면 ${index + 1} 제목`} onChange={(event) => updateScene(scene.id, { title: event.target.value })} /><textarea value={scene.sourceText} aria-label={`장면 ${index + 1} 내용`} onChange={(event) => updateScene(scene.id, { sourceText: event.target.value })} /></article>)}</div><div className="flow-actions"><button className="secondary" onClick={() => setStage('script')}>이전</button><button onClick={() => setStage('setup')}>Storyboard 설정</button></div></section>}
    {stage === 'setup' && <section className="setup-section"><div className="setup-heading"><p className="eyebrow">STORYBOARD</p><h2>그림체 선택</h2><p>스토리보드에 사용할 그림체와 이미지 모델을 선택하세요. 이후 Panels에서 바꿀 수 있습니다.</p></div><div className="style-options"><button className={artStyle === 'detailed' ? 'style-option selected' : 'style-option'} onClick={() => setArtStyle('detailed')}><img className="style-preview" src={detailedStyle} alt="디테일 스케치 예시" /><strong>디테일 스케치</strong><small>손으로 그린 스토리보드</small></button><button className={artStyle === 'photoreal' ? 'style-option selected' : 'style-option'} onClick={() => setArtStyle('photoreal')}><img className="style-preview" src={photorealStyle} alt="실사 프리비즈 예시" /><strong>실사 프리비즈</strong><small>현실적인 시네마틱 이미지</small></button></div><label className="baseline-model-picker" htmlFor="baseline-image-model"><span>이미지 모델</span><select id="baseline-image-model" value={panelImageModel} onChange={(event) => setPanelImageModel(event.target.value)}><option value="gpt-image-1">GPT Image 1</option><option value="gpt-image-2">GPT Image 2</option><option value="flux-2-klein">FLUX.2 Klein (빠름)</option></select></label><div className="setup-actions"><button className="secondary" onClick={() => setStage('review')}>이전</button><button onClick={prepareStoryboard}>스토리보드 생성</button></div></section>}
    {stage === 'generating' && <section className="generate-section"><p className="eyebrow">STORYBOARD</p><h2>스토리보드 준비</h2><p>{busy ? '캐릭터 레퍼런스를 생성하고 있습니다. 완료되면 바로 확인할 수 있습니다.' : '확인한 씬과 선택한 그림체를 바탕으로 Panels를 준비했습니다.'}</p><ul><li>✓ 씬 구성 정리</li><li>✓ 샷 카드 준비</li><li>✓ 그림체 설정 적용: {artStyle === 'detailed' ? '디테일 스케치' : '실사 프리비즈'}</li><li>{busy ? '… 캐릭터 레퍼런스 생성 중' : '✓ 캐릭터 레퍼런스 준비 완료'}</li></ul><div className="flow-actions"><button className="secondary" onClick={() => setStage('setup')}>이전</button><button onClick={() => setStage('characters')} disabled={busy}>캐릭터 확인</button></div></section>}
    {stage === 'characters' && (
      <section className="character-section">
        <div className="review-heading">
          <div>
            <p className="eyebrow">STORYBOARD</p>
            <h2>캐릭터 확인</h2>
            <p>스토리보드에 등장하는 캐릭터를 확인하고 필요하면 수정하세요.</p>
          </div>
        </div>
        <div className="character-grid">
          {(characters || []).map((character) => character && (
            <article className="character-card" key={character.id}>
              <div
                className={"character-image " + (character.image ? "has-image" : "empty") + (characterPending[character.id] ? " is-pending" : "")}
                onClick={() => character.image && setPreviewImage({ src: character.image, name: character.name || '캐릭터' })}
                role={character.image ? 'button' : undefined}
                tabIndex={character.image ? 0 : undefined}
                onKeyDown={(event) => {
                  if (character.image && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    setPreviewImage({ src: character.image, name: character.name || '캐릭터' })
                  }
                }}
                aria-label={character.image ? `${character.name || '캐릭터'} 이미지 확대` : undefined}
              >
                {character.image ? (
                  <img src={character.image} alt={character.name || '캐릭터'} />
                ) : characterPending[character.id] ? (
                  <div className="card-image-placeholder pending">
                    <div className="image-spinner" />
                    <span>인물 생성 중…</span>
                  </div>
                ) : (
                  <div className="card-image-placeholder">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span className="placeholder-title">인물 이미지</span>
                  </div>
                )}
              </div>
              <input
                value={character.name || ''}
                aria-label="캐릭터 이름"
                onChange={(event) => setCharacters((items) => (items || []).map((item) => item?.id === character.id ? { ...item, name: event.target.value } : item))}
              />
              <textarea
                value={character.description || ''}
                aria-label={`${character.name || '캐릭터'} 설명`}
                placeholder="외형 설명 (예: 20대 여성, 단정한 묶음머리, 네이비 유니폼)"
                onChange={(event) => setCharacters((items) => (items || []).map((item) => item?.id === character.id ? { ...item, description: event.target.value } : item))}
              />
              <div className="character-action">
                <button
                  onClick={() => generateCharacterReference(character)}
                  disabled={characterPending[character.id]}
                >
                  {characterPending[character.id] ? '생성 중…' : character.image ? '다시 생성' : '생성'}
                </button>
                {(characters || []).length > 1 && (
                  <button
                    className="delete"
                    onClick={() => setCharacters((items) => (items || []).filter((item) => item?.id !== character.id))}
                  >
                    삭제
                  </button>
                )}
              </div>
            </article>
          ))}
          <button
            className="character-add"
            onClick={() => setCharacters((items) => [...(items || []), { id: uid('character'), name: '새 캐릭터', description: '20대 인물, 단정한 캐주얼 복장', image: null }])}
          >
            ＋<span>캐릭터 추가</span>
          </button>
        </div>
        <div className="flow-actions">
          <button className="secondary" onClick={() => setStage('generating')}>이전</button>
          <button onClick={enterPanels} disabled={!referencesReady || referencesPending}>
            {referencesPending ? '레퍼런스 생성 중…' : referencesReady ? 'Panels 보기' : '레퍼런스 준비 필요'}
          </button>
        </div>
      </section>
    )}

    {previewImage && <div className="image-preview-overlay" onClick={() => setPreviewImage(null)} role="presentation"><div className="image-preview-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${previewImage.name} 이미지 확대`}><button className="image-preview-close" onClick={() => setPreviewImage(null)} aria-label="이미지 닫기">✕</button><img src={previewImage.src} alt={previewImage.name} /><p>{previewImage.name}</p></div></div>}
    {stage === 'panels' && activeScene && <section className="board"><aside className="board-nav"><strong>▣ Storyboard</strong><button className="board-nav-active">▤ Panels</button><hr />{scenes.map((scene, index) => <button key={scene.id} className={scene.id === activeScene.id ? 'scene active' : 'scene'} onClick={() => { setActiveSceneId(scene.id); setActiveShotId(scene.shots[0]?.id || null) }}>Scene {index + 1}<small>{scene.title}</small></button>)}</aside><section className="board-main"><div className="board-title"><div><h2>{activeScene.title}</h2><span>{artStyle === 'detailed' ? '디테일 스케치' : '실사 프리비즈'}</span></div><button onClick={() => generateSceneShots(activeScene)} disabled={(activeScene.shots || []).some((shot) => panelPending[shot.id])}>{(activeScene.shots || []).some((shot) => panelPending[shot.id]) ? '생성 중…' : `Scene ${scenes.indexOf(activeScene) + 1} 생성`}</button></div><div className="card-grid">{(activeScene?.shots || []).map((shot, index) => shot && <article className="board-card" key={shot.id}><div className={"card-image " + (shot.image ? "has-image" : "empty") + (panelPending[shot.id] ? " is-pending" : "")}>
  {shot.image ? (
    <><img src={shot.image} alt={"Shot " + (index + 1)} />{panelPending[shot.id] && <div className="card-image-progress"><div className="image-spinner" /><span>AI 패널 다시 생성 중…</span></div>}</>
  ) : panelPending[shot.id] ? (
    <div className="card-image-placeholder pending">
      <div className="image-spinner" />
      <span>AI 패널 생성 중…</span>
    </div>
  ) : (
    <div className="card-image-placeholder">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <span className="placeholder-title">미생성 샷</span>
      <span className="placeholder-sub">하단 생성 버튼을 눌러보세요</span>
    </div>
  )}
</div><div className="card-copy"><strong>Scene {scenes.indexOf(activeScene) + 1} | Shot {index + 1}</strong><textarea value={shot.description || ''} aria-label={`샷 ${index + 1} 설명`} onChange={(event) => { updateShot(shot.id, { description: event.target.value }); logShotEdit(shot.id, 'description') }} /><MentionBadges shot={shot} characters={characters} /></div><footer><button className="edit-btn" onClick={() => openShotEditor(shot)}>Edit</button><button onClick={() => generateShot(shot)} disabled={panelPending[shot.id]}>{panelPending[shot.id] ? '생성 중…' : shot.image ? '다시 생성' : '생성'}</button><button className="delete" onClick={() => deleteShot(shot.id)}>삭제</button></footer>{index < activeScene.shots.length - 1 && <button className="insert-between" aria-label={`샷 ${index + 1} 뒤에 삽입`} onClick={() => insertShot(index + 1)}>＋</button>}</article>)}</div></section></section>}
    
    {editingShotId && (() => {
      const editingShot = activeScene?.shots.find((s) => s.id === editingShotId)
      if (!editingShot) return null
      const shotIndex = activeScene.shots.findIndex((s) => s.id === editingShotId)
      return (
        <div className="modal-overlay" onClick={() => closeShotEditor()}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Shot {shotIndex + 1} 편집</h3>
              <button className="modal-close" onClick={() => closeShotEditor()}>✕</button>
            </div>
            <div className="modal-body">
              {editingShot.image && <button className="modal-panel-preview" onClick={() => setPreviewImage({ src: editingShot.image, name: `Shot ${shotIndex + 1}` })}><img src={editingShot.image} alt={`Shot ${shotIndex + 1} 현재 패널`} /><span>현재 패널 · 클릭하여 확대</span></button>}
              <p className="modal-shot-summary">현재 설정: {editingShot.shotSize || '샷 크기 미정'} · {editingShot.perspective || '앵글 미정'}</p>
              <label>샷 제목</label>
              <input
                type="text"
                value={editingShot.title || ''}
                onChange={(e) => { updateShot(editingShot.id, { title: e.target.value }); logShotEdit(editingShot.id, 'title') }}
              />
              <div className="modal-row">
                <div className="modal-field">
                  <label>Size (샷 크기)</label>
                  <select
                    value={editingShot.shotSize || ''}
                    onChange={(e) => { updateShot(editingShot.id, { shotSize: e.target.value }); logShotEdit(editingShot.id, 'shotSize') }}
                  >
                    <option value="">미정</option>
                    <option value="Extreme Wide Shot">Extreme Wide Shot (EWS)</option>
                    <option value="Wide Shot">Wide Shot (WS)</option>
                    <option value="Full Shot">Full Shot (FS)</option>
                    <option value="Medium Shot">Medium Shot (MS)</option>
                    <option value="Medium Close-Up">Medium Close-Up (MCU)</option>
                    <option value="Close-Up">Close-Up (CU)</option>
                    <option value="Extreme Close-Up">Extreme Close-Up (ECU)</option>
                  </select>
                </div>
                <div className="modal-field">
                  <label>Perspective (시점 / 앵글)</label>
                  <select
                    value={editingShot.perspective || ''}
                    onChange={(e) => { updateShot(editingShot.id, { perspective: e.target.value }); logShotEdit(editingShot.id, 'perspective') }}
                  >
                    <option value="">미정</option>
                    <option value="Eye Level">Eye Level (아이 레벨)</option>
                    <option value="High Angle">High Angle (하이 앵글)</option>
                    <option value="Low Angle">Low Angle (로우 앵글)</option>
                    <option value="OTS (Over the Shoulder)">Over the Shoulder (OTS)</option>
                    <option value="POV (Point of View)">Point of View (POV)</option>
                    <option value="Top-Down / Overhead">Top-Down (탑다운)</option>
                    <option value="Dutch Angle">Dutch Angle (더치 앵글)</option>
                  </select>
                </div>
              </div>
              <label>샷 설명 / 프롬프트</label>
              <textarea
                rows={5}
                value={editingShot.description || ''}
                onChange={(e) => { updateShot(editingShot.id, { description: e.target.value }); logShotEdit(editingShot.id, 'description') }}
              />
              <MentionBadges shot={editingShot} characters={characters} />
              {editingShot.image && (
                <div className="modal-image-actions">
                  <button className="delete" onClick={() => { updateShot(editingShot.id, { image: null }); logEdit({ level: 'element', target: editingShot.id, action: 'remove_image' }) }}>이미지 제거</button>
                </div>
              )}
            </div>
            {/* `완료`는 고친 값을 저장만 한다(이미 updateShot이 즉시 반영).
                고친 값으로 그림까지 보려면 여기서 바로 다시 그린다 — 모달을
                닫고 카드에서 그 샷을 다시 찾게 하지 않는다. 진행 상태는
                카드의 pending 표시가 함께 맡는다. */}
            <div className="modal-footer">
              <button className="secondary" onClick={() => closeShotEditor()}>완료</button>
              <button
                disabled={panelPending[editingShot.id]}
                onClick={() => {
                  setEditingShotId(null)
                  generateShot(editingShot)
                }}
              >
                {panelPending[editingShot.id]
                  ? '생성 중…'
                  : editingShot.image ? '이 설정으로 다시 생성' : '이 설정으로 생성'}
              </button>
            </div>
          </div>
        </div>
      )
    })()}

    {/* 실험 진행 줄. SceneLens와 **같은 조작**을 둔다 — 참가자가 두
        조건을 오가므로 여기서 다르면 그 차이 자체가 조건 간 차이로
        섞인다. 측정값은 보여 주지 않는다. */}
    <div className={`study-bar is-${studyPhase}`}>
      {studyPhase === 'tutorial' && (
        <button type="button" className="study-bar-start" onClick={() => {
          startTask()
          setStudyPhase(phase())
        }}>
          과제 시작
        </button>
      )}
      {studyPhase === 'task' && (
        <>
          <span className="study-bar-state">진행 중</span>
          <button type="button" className="study-bar-end" onClick={async () => {
            if (!window.confirm('과제를 끝내고 결과를 내보낼까요?')) return
            // 반드시 먼저 끝낸다 — 내보내기가 앞서면 그 순간까지가
            // task로 잡혀 측정 구간의 끝이 흐려진다.
            endTask()
            setStudyPhase(phase())
            await exportData()
          }}>
            과제 종료 · 내보내기
          </button>
        </>
      )}
      {studyPhase === 'done' && (
        <button type="button" className="study-bar-export" onClick={exportData}>
          결과 다시 내보내기
        </button>
      )}
      {/* 서버 저장이 확인된 뒤에만. 파일은 실험자 컴퓨터에 있지만 그것이
          제자리에 있는지 시스템은 알 수 없다. */}
      {studyPhase === 'done' && uploaded && (
        <button type="button" className="study-bar-next" onClick={() => {
          if (!window.confirm(
            '이 세션을 지우고 다음 참가자(또는 다음 조건)를 준비합니다.\n'
            + '서버 저장은 확인됐습니다. 계속할까요?',
          )) return
          resetLog()
          setStudyPhase(phase())
          setUploaded(false)
        }}>
          다음 참가자 · 조건 준비
        </button>
      )}
    </div>
  </main>
}
