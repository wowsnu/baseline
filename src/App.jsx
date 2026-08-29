import { useEffect, useRef, useState } from 'react'
import { EXAMPLE_CHARACTERS, EXAMPLE_SCENES, EXAMPLE_STORY } from './exampleData.js'
import detailedStyle from '../../v3/public/img/style-anchors/lab-detailed-storyboard.png'
import photorealStyle from '../../v3/public/img/style-anchors/lab-photoreal-previz.png'

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
function buildBaselinePanelPrompt(shot, scene) {
  const isPov = shot.perspective === 'POV (Point of View)'
  const angle = BASELINE_ANGLE[shot.perspective] || ''
  const size = BASELINE_SHOT_SIZE[shot.shotSize] || shot.shotSize || ''
  const action = (shot.description || shot.title || '').replace(/[.。]\s*$/, '')
  return [
    scene?.title && `${scene.title}.`,
    angle && `${angle}.`,
    !isPov && size && `${size}.`,
    action && `${action}.`,
  ].filter(Boolean).join(' ')
}

async function referenceImageBase64(image) {
  if (!image) return ''
  const [, data] = image.split(',', 2)
  if (image.startsWith('data:')) return data || ''
  // 예시 이미지는 Vite의 정적 파일 URL이다. SceneLens처럼 실제 base64를
  // 보내야 백엔드가 이를 이미지 레퍼런스로 인식한다.
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
  const lines = story.split(/\n+|(?<=[.!?。])\s+/).map((line) => line.trim()).filter(Boolean)
  return [{
    id: uid('scene'), title: '장면 1', sourceText: story,
    facts: { location: '', time: '' },
    shots: lines.map((description, index) => ({ id: uid('shot'), title: `샷 ${index + 1}`, description, image: null })),
  }]
}

function fromStructure(data, story) {
  return data.scenes.map((scene, sceneIndex) => {
    const descriptions = scene.beats.flatMap((beat) => beat.lines.map((line) => line.text)).filter(Boolean)
    return {
      id: uid('scene'), title: scene.heading || `장면 ${sceneIndex + 1}`,
      sourceText: descriptions.join('\n') || story,
      facts: factsFromHeading(scene.heading),
      shots: (descriptions.length ? descriptions : [story]).map((description, index) => ({
        id: uid('shot'), title: `샷 ${index + 1}`, description, image: null,
      })),
    }
  })
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
  const [activeSceneId, setActiveSceneId] = useState(EXAMPLE_SCENES[0].id)
  const [activeShotId, setActiveShotId] = useState(EXAMPLE_SCENES[0].shots[0].id)
  const [stage, setStage] = useState('script')
  const [artStyle, setArtStyle] = useState('detailed')
  const [characters, setCharacters] = useState(EXAMPLE_CHARACTERS)
  const [characterPending, setCharacterPending] = useState({})
  const [panelPending, setPanelPending] = useState({})
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [editingShotId, setEditingShotId] = useState(null)
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || scenes[0]
  const isMockData = story.trim() === EXAMPLE_STORY.trim()

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (saved?.scenes) {
        setStory(saved.story || '')
        setScenes(saved.scenes)
        setActiveSceneId(saved.activeSceneId || saved.scenes[0]?.id || null)
        setActiveShotId(saved.activeShotId || null)
        // 실험은 언제나 같은 첫 화면에서 시작해야 한다. 편집 데이터는
        // 복원하되, 마지막에 보던 단계는 복원하지 않는다.
        setStage('script')
        setArtStyle(saved.artStyle === 'photoreal' ? 'photoreal' : 'detailed')
        setCharacters(saved.story === EXAMPLE_STORY ? EXAMPLE_CHARACTERS : (saved.characters ?? EXAMPLE_CHARACTERS))
      }
    } catch { /* corrupted local data should not stop the editor */ }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated || !scenes.length) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ story, scenes, activeSceneId, activeShotId, stage, artStyle, characters }))
  }, [story, scenes, activeSceneId, activeShotId, stage, artStyle, characters, hydrated])

  const updateScene = (sceneId, update) => setScenes((current) => current.map((scene) => (
    scene.id === sceneId ? { ...scene, ...update } : scene
  )))
  const updateShot = (shotId, update) => setScenes((current) => current.map((scene) => ({
    ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, ...update } : shot),
  })))
  const createStoryboard = async () => {
    if (!story.trim()) { setNotice('대본을 입력해 주세요.'); return }
    // 예시 대본은 기존 데모와 같은 씬·샷·패널을 즉시 연다. 모델에 다시
    // 보내면 예시의 순서와 문장이 달라질 수 있다.
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
      const nextScenes = fromStructure(await response.json(), story.trim())
      setScenes(nextScenes); setActiveSceneId(nextScenes[0]?.id || null); setActiveShotId(nextScenes[0]?.shots[0]?.id || null)
      setStage('review')
      setNotice('장면과 기본 샷을 만들었습니다. 필요한 내용을 직접 편집하세요.')
    } catch {
      const nextScenes = localStructure(story.trim())
      setScenes(nextScenes); setActiveSceneId(nextScenes[0].id); setActiveShotId(nextScenes[0].shots[0]?.id || null)
      setStage('review')
      setNotice('자동 분할 서버에 연결되지 않아 입력 문장으로 기본 샷을 만들었습니다.')
    } finally { setBusy(false) }
  }

  const insertShot = (at) => {
    if (!activeScene) return
    // 빈 칸이 아니라 두 패널 사이에 끼운 샷이라는 정보만 남긴다. 생성할 때
    // SceneLens와 같이 양옆 패널을 연속성 기준으로 물리되, 내용 제안은 하지 않는다.
    const shot = { id: uid('shot'), title: '새 샷', description: '', image: null, inserted: true }
    updateScene(activeScene.id, { shots: [...activeScene.shots.slice(0, at), shot, ...activeScene.shots.slice(at)] })
    setActiveShotId(shot.id)
  }
  const deleteShot = (shotId) => {
    if (!activeScene || activeScene.shots.length <= 1) { setNotice('각 장면에는 샷 한 장 이상이 필요합니다.'); return }
    const index = activeScene.shots.findIndex((shot) => shot.id === shotId)
    const next = activeScene.shots.filter((shot) => shot.id !== shotId)
    updateScene(activeScene.id, { shots: next })
    if (activeShotId === shotId) setActiveShotId(next[Math.min(index, next.length - 1)].id)
  }
  const moveShot = (shotId, direction) => {
    if (!activeScene) return
    const index = activeScene.shots.findIndex((shot) => shot.id === shotId)
    const target = index + direction
    if (target < 0 || target >= activeScene.shots.length) return
    const next = [...activeScene.shots]; [next[index], next[target]] = [next[target], next[index]]
    updateScene(activeScene.id, { shots: next })
  }
  const exportData = async () => {
    const payload = { schema_version: '2.0', exported_at: new Date().toISOString(), tool: 'baseline', story, scenes, art_style: artStyle }
    const response = await fetch('/api/study/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'baseline', payload }) })
    if (!response.ok) { setNotice('서버 저장에 실패했습니다.'); return }
    setNotice('실험 데이터가 서버에 저장되었습니다.')
  }
  const generateCharacterReference = async (character) => {
    if (isMockData) { setNotice('예시 데이터에서는 이미지 생성을 하지 않습니다.'); return }
    const prompt = `${character.name}. ${character.description || '스토리보드에 등장하는 인물'}`.trim()
    if (!character.name.trim()) { setNotice('캐릭터 이름을 입력해 주세요.'); return }
    setCharacterPending((current) => ({ ...current, [character.id]: true }))
    try {
      const response = await fetch('/api/reference-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'character', prompt, style_preset: artStyle, model: 'gpt-image-1' }),
      })
      if (!response.ok) throw new Error('reference image unavailable')
      const data = await response.json()
      setCharacters((items) => items.map((item) => item.id === character.id ? { ...item, image: `data:image/png;base64,${data.image}` } : item))
    } catch { setNotice('인물 레퍼런스를 만들지 못했습니다. 백엔드 연결을 확인해 주세요.') } finally {
      setCharacterPending((current) => ({ ...current, [character.id]: false }))
    }
  }
  const generateShot = async (shot) => {
    if (isMockData) { setNotice('예시 데이터에서는 이미지 생성을 하지 않습니다.'); return }
    setPanelPending((current) => ({ ...current, [shot.id]: true }))
    try {
      const scene = activeScene
      const shotIndex = scene?.shots.findIndex((item) => item.id === shot.id) ?? -1
      const previousShot = shotIndex > 0 ? scene.shots[shotIndex - 1] : null
      // SceneLens처럼 이 샷에 명시된 인물을 우선 참조한다. Baseline에는
      // 샷별 캐스트 입력이 없으므로 이름이 나오지 않은 경우에만 전체 캐스트를 쓴다.
      const namedCharacters = characters.filter((character) => (
        character.image && (shot.description || '').includes(character.name)
      ))
      const referenceCharacters = namedCharacters.length
        ? namedCharacters
        : characters.filter((character) => character.image)
      const styleImage = artStyle === 'photoreal' ? photorealStyle : detailedStyle
      const continuityReferences = shot.inserted ? [
        previousShot?.image && { name: '앞 패널', kind: 'neighbor-before', image: previousShot.image },
        scene?.shots[shotIndex + 1]?.image && { name: '뒤 패널', kind: 'neighbor-after', image: scene.shots[shotIndex + 1].image },
      ].filter(Boolean) : []
      const references = (await Promise.all([
        { name: artStyle === 'photoreal' ? '실사 프리비즈' : '디테일 스케치', kind: 'style', image: styleImage },
        ...continuityReferences,
        ...referenceCharacters.map((character) => ({ name: character.name, kind: 'character', image: character.image })),
      ].map(async (reference) => ({
        ...reference,
        image: await referenceImageBase64(reference.image),
      })))).filter((reference) => reference.image)
      const response = await fetch('/api/panel-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildBaselinePanelPrompt(shot, scene),
          shared: scene?.sourceText || '',
          previous: previousShot ? buildBaselinePanelPrompt(previousShot, scene) : '',
          references,
          style: '', style_preset: artStyle, layout: '', changes: [], model: 'gpt-image-1',
        }),
      })
      if (!response.ok) throw new Error('panel image unavailable')
      const data = await response.json()
      updateShot(shot.id, { image: `data:image/png;base64,${data.image}`, inserted: false })
    } catch { setNotice('패널 이미지를 만들지 못했습니다. 백엔드 연결을 확인해 주세요.') } finally { setPanelPending((current) => ({ ...current, [shot.id]: false })) }
  }
  const generateSceneShots = async (targetScene) => {
    if (isMockData) return
    const scene = targetScene || activeScene
    if (!scene) return
    const targetList = scene.shots.filter((shot) => !shot.image)
    if (!targetList.length) return
    setNotice(targetList.length + '개 샷의 패널 생성을 시작합니다…')
    for (const shot of targetList) {
      await generateShot(shot)
    }
  }
  useEffect(() => {
    if (stage === 'panels' && activeScene && !isMockData) void generateSceneShots(activeScene)
  }, [stage])
  const loadExample = () => {
    setStory(EXAMPLE_STORY); setScenes(EXAMPLE_SCENES); setStage('script')
    setCharacters(EXAMPLE_CHARACTERS)
    setActiveSceneId(EXAMPLE_SCENES[0].id); setActiveShotId(EXAMPLE_SCENES[0].shots[0].id)
    setNotice('예시 대본과 패널을 불러왔습니다.')
  }

  return <main className="app">
    <header><div><p className="eyebrow">STORYBOARD EDITOR</p><h1>Storyboard</h1></div><div>{stage === 'panels' && <button className="secondary" onClick={() => setStage('characters')}>이전</button>} <button className="secondary" onClick={exportData} disabled={!scenes.length}>내보내기</button></div></header>
    <nav className="progress" aria-label="작업 단계"><span className={stage === 'script' ? 'current' : 'done'}>1. Idea</span><span className={stage === 'review' ? 'current' : ['setup', 'generating', 'characters', 'panels'].includes(stage) ? 'done' : ''}>2. Story</span><span className={['setup', 'generating', 'characters', 'panels'].includes(stage) ? 'current' : ''}>3. Storyboard</span></nav>
    {stage === 'script' && <section className="script-section"><label htmlFor="story">대본</label><textarea id="story" value={story} onChange={(e) => setStory(e.target.value)} placeholder="스토리를 입력하세요. 장소나 시간이 바뀌면 새 장면으로 나뉩니다." /><div className="script-actions"><span>{notice}</span><div><button className="secondary" onClick={loadExample}>예시 대본 불러오기</button> <button onClick={createStoryboard} disabled={busy}>{busy ? '나누는 중…' : '씬 구성 만들기'}</button></div></div></section>}
    {stage === 'review' && <section className="review-section"><div className="review-heading"><div><p className="eyebrow">STORY</p><h2>씬 구성 확인</h2><p>자동으로 나뉘고 보강된 장면입니다. 필요한 내용을 확인한 뒤 Panels로 넘어가세요.</p></div></div><div className="review-scenes">{scenes.map((scene, index) => <article className="review-scene" key={scene.id}><p>SCENE {index + 1}</p><input value={scene.title} aria-label={`장면 ${index + 1} 제목`} onChange={(event) => updateScene(scene.id, { title: event.target.value })} /><textarea value={scene.sourceText} aria-label={`장면 ${index + 1} 내용`} onChange={(event) => updateScene(scene.id, { sourceText: event.target.value })} /></article>)}</div><div className="flow-actions"><button className="secondary" onClick={() => setStage('script')}>이전</button><button onClick={() => setStage('setup')}>Storyboard 설정</button></div></section>}
    {stage === 'setup' && <section className="setup-section"><div className="setup-heading"><p className="eyebrow">STORYBOARD</p><h2>그림체 선택</h2><p>스토리보드에 사용할 그림체를 선택하세요. 이후 Panels에서 바꿀 수 있습니다.</p></div><div className="style-options"><button className={artStyle === 'detailed' ? 'style-option selected' : 'style-option'} onClick={() => setArtStyle('detailed')}><img className="style-preview" src={detailedStyle} alt="디테일 스케치 예시" /><strong>디테일 스케치</strong><small>손으로 그린 스토리보드</small></button><button className={artStyle === 'photoreal' ? 'style-option selected' : 'style-option'} onClick={() => setArtStyle('photoreal')}><img className="style-preview" src={photorealStyle} alt="실사 프리비즈 예시" /><strong>실사 프리비즈</strong><small>현실적인 시네마틱 이미지</small></button></div><div className="setup-actions"><button className="secondary" onClick={() => setStage('review')}>이전</button><button onClick={() => setStage('generating')}>스토리보드 생성</button></div></section>}
    {stage === 'generating' && <section className="generate-section"><p className="eyebrow">STORYBOARD</p><h2>스토리보드 준비</h2><p>확인한 씬과 선택한 그림체를 바탕으로 Panels를 준비했습니다.</p><ul><li>✓ 씬 구성 정리</li><li>✓ 샷 카드 준비</li><li>✓ 그림체 설정 적용: {artStyle === 'detailed' ? '디테일 스케치' : '실사 프리비즈'}</li></ul><div className="flow-actions"><button className="secondary" onClick={() => setStage('setup')}>이전</button><button onClick={() => setStage('characters')}>캐릭터 확인</button></div></section>}
    {stage === 'characters' && <section className="character-section"><div className="review-heading"><div><p className="eyebrow">STORYBOARD</p><h2>캐릭터 확인</h2><p>스토리보드에 등장하는 캐릭터를 확인하고 필요하면 수정하세요.</p></div></div><div className="character-grid">{characters.map((character) => <article className="character-card" key={character.id}><div className={"character-image " + (character.image ? "has-image" : "empty") + (characterPending[character.id] ? " is-pending" : "")}>
  {character.image ? (
    <img src={character.image} alt={character.name} />
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
</div><input value={character.name} aria-label="캐릭터 이름" onChange={(event) => setCharacters((items) => items.map((item) => item.id === character.id ? { ...item, name: event.target.value } : item))} /><textarea value={character.description} aria-label={`${character.name} 설명`} placeholder="캐릭터 설명" onChange={(event) => setCharacters((items) => items.map((item) => item.id === character.id ? { ...item, description: event.target.value } : item))} /><div className="character-action"><button onClick={() => generateCharacterReference(character)} disabled={characterPending[character.id]}>{characterPending[character.id] ? '생성 중…' : character.image ? '다시 생성' : '생성'}</button></div></article>)}<button className="character-add" onClick={() => setCharacters((items) => [...items, { id: uid('character'), name: '새 캐릭터', description: '', image: null }])}>＋<span>캐릭터 추가</span></button></div><div className="flow-actions"><button className="secondary" onClick={() => setStage('generating')}>이전</button><button onClick={() => setStage('panels')}>Panels 보기</button></div></section>}
    {stage === 'panels' && activeScene && <section className="board"><aside className="board-nav"><strong>▣ Storyboard</strong><button className="board-nav-active">▤ Panels</button><button onClick={() => setStage('review')}>☷ Story</button><button onClick={() => setStage('characters')}>♙ Characters</button><hr />{scenes.map((scene, index) => <button key={scene.id} className={scene.id === activeScene.id ? 'scene active' : 'scene'} onClick={() => { setActiveSceneId(scene.id); setActiveShotId(scene.shots[0]?.id || null) }}>Scene {index + 1}<small>{scene.title}</small></button>)}</aside><section className="board-main"><div className="board-title"><div><h2>{activeScene.title}</h2><span>{artStyle === 'detailed' ? '디테일 스케치' : '실사 프리비즈'}</span></div></div><div className="card-grid">{activeScene.shots.map((shot, index) => <article className="board-card" key={shot.id}><div className={"card-image " + (shot.image ? "has-image" : "empty") + (panelPending[shot.id] ? " is-pending" : "")}>
  {shot.image ? (
    <img src={shot.image} alt={"Shot " + (index + 1)} />
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
</div><div className="card-copy"><strong>Scene {scenes.indexOf(activeScene) + 1} | Shot {index + 1}</strong><textarea value={shot.description} aria-label={`샷 ${index + 1} 설명`} onChange={(event) => updateShot(shot.id, { description: event.target.value })} /></div><footer><button className="edit-btn" onClick={() => setEditingShotId(shot.id)}>Edit</button><button onClick={() => generateShot(shot)} disabled={panelPending[shot.id]}>{shot.image ? '다시 생성' : '생성'}</button><button className="delete" onClick={() => deleteShot(shot.id)}>삭제</button></footer>{index < activeScene.shots.length - 1 && <button className="insert-between" aria-label={`샷 ${index + 1} 뒤에 삽입`} onClick={() => insertShot(index + 1)}>＋</button>}</article>)}</div></section></section>}
    
    {editingShotId && (() => {
      const editingShot = activeScene?.shots.find((s) => s.id === editingShotId)
      if (!editingShot) return null
      const shotIndex = activeScene.shots.findIndex((s) => s.id === editingShotId)
      return (
        <div className="modal-overlay" onClick={() => setEditingShotId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Shot {shotIndex + 1} 편집</h3>
              <button className="modal-close" onClick={() => setEditingShotId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <label>샷 제목</label>
              <input
                type="text"
                value={editingShot.title || ''}
                onChange={(e) => updateShot(editingShot.id, { title: e.target.value })}
              />
              <div className="modal-row">
                <div className="modal-field">
                  <label>Size (샷 크기)</label>
                  <select
                    value={editingShot.shotSize || ''}
                    onChange={(e) => updateShot(editingShot.id, { shotSize: e.target.value })}
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
                    onChange={(e) => updateShot(editingShot.id, { perspective: e.target.value })}
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
                onChange={(e) => updateShot(editingShot.id, { description: e.target.value })}
              />
              {editingShot.image && (
                <div className="modal-image-actions">
                  <button className="delete" onClick={() => updateShot(editingShot.id, { image: null })}>이미지 제거</button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditingShotId(null)}>완료</button>
            </div>
          </div>
        </div>
      )
    })()}
  </main>
}
