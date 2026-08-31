/**
 * 실험 로그 — baseline 쪽.
 *
 * SceneLens와 **같은 스키마**로 남긴다. 프로토콜 5.2가 두 조건의 수정
 * 행동을 로그로 견주라고 하는데, 모양이 다르면 견줄 수가 없다. 그래서
 * 이벤트 이름(`edit`/`panel_generate`), 층위 값(element/shot/seam/
 * sequence), 저장 키까지 SceneLens의 `src/store/studyLog.js`와 맞춘다.
 *
 * 다만 **없는 것을 만들지 않는다.** baseline에는 렌즈도, 이음새 조작도,
 * 장면 기준 수정도 없다. 그것이 이 조건의 사실이므로 0으로 남아야 하고,
 * 억지로 채우면 비교가 거짓이 된다.
 *
 * 새로고침을 견뎌야 한다. 참가자가 실수로 새로고침하면 그 세션이 통째로
 * 없어지는데 실험 중에는 복구할 방법이 없다. 그래서 localStorage에 쌓는다.
 */

const STORAGE_KEY = 'scenelens.study.log'
const SESSION_KEY = 'scenelens.study.session'
const CONDITION_KEY = 'scenelens.study.condition'
const ORDER_KEY = 'scenelens.study.order'
const PHASE_KEY = 'scenelens.study.phase'
const TASK_START_KEY = 'scenelens.study.task_started_at'
const EXPORTED_KEY = 'scenelens.study.exported_at'
const UPLOADED_KEY = 'scenelens.study.uploaded_at'

/** 이 수정이 패널 안의 일인가, 그 너머인가. SceneLens와 같은 정의. */
export const BEYOND_PANEL_LEVELS = ['shot', 'seam', 'sequence']

const newSessionId = () => (
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
)

const readJSON = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const writeJSON = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const sessionId = () => {
  let id = readJSON(SESSION_KEY, null)
  if (!id) {
    id = newSessionId()
    writeJSON(SESSION_KEY, id)
  }
  return id
}

export const condition = () => readJSON(CONDITION_KEY, null) || 'unset'
export const setCondition = (value) => { writeJSON(CONDITION_KEY, value); return value }

/** 이 조건이 이 참가자의 몇 번째인가. within-subjects의 순서 효과를 가른다. */
export const conditionOrder = () => readJSON(ORDER_KEY, null) || 'unset'
export const setConditionOrder = (value) => { writeJSON(ORDER_KEY, value); return value }

/** 튜토리얼인가 본 과제인가. 시작 전 기록은 지우지 않고 표시만 한다. */
export const phase = () => readJSON(PHASE_KEY, null) || 'tutorial'
export const taskStartedAt = () => readJSON(TASK_START_KEY, null)
export const exportedAt = () => readJSON(EXPORTED_KEY, null)
export const uploadedAt = () => readJSON(UPLOADED_KEY, null)
export const markUploaded = () => { const at = Date.now(); writeJSON(UPLOADED_KEY, at); return at }

export const readLog = () => readJSON(STORAGE_KEY, [])

export const logEvent = (type, payload = {}) => {
  if (typeof window === 'undefined') return null
  const log = readLog()
  const event = {
    id: `e${log.length + 1}`,
    t: Date.now(),
    session: sessionId(),
    condition: condition(),
    conditionOrder: conditionOrder(),
    phase: phase(),
    type,
    ...payload,
  }
  log.push(event)
  writeJSON(STORAGE_KEY, log)
  return event
}

export const startTask = () => {
  writeJSON(PHASE_KEY, 'task')
  const at = Date.now()
  writeJSON(TASK_START_KEY, at)
  logEvent('phase_start', { phase: 'task' })
  return at
}

export const endTask = () => {
  logEvent('phase_end', { phase: 'task' })
  writeJSON(PHASE_KEY, 'done')
  return true
}

/**
 * 수정 하나.
 *
 * lens는 늘 null이다 — baseline에는 관점이 없다. 그것이 이 조건의
 * 사실이고, 채워 넣으면 조건 비교가 거짓이 된다.
 */
export const logEdit = ({ level, target = null, action = null, source = 'manual', ...rest }) => (
  logEvent('edit', {
    lens: null,
    level,
    target,
    action,
    source,
    beyondPanel: BEYOND_PANEL_LEVELS.includes(level),
    ...rest,
  })
)

export const summarize = (fullLog = readLog()) => {
  const tutorialEvents = fullLog.filter((e) => e.phase === 'tutorial')
  const log = fullLog.filter((e) => e.phase === 'task')
  const afterEvents = fullLog.filter((e) => e.phase === 'done')
  const edits = log.filter((e) => e.type === 'edit')
  const generates = log.filter((e) => e.type === 'panel_generate')
  const count = (items, key) => items.reduce((acc, item) => {
    const value = item[key] || 'unspecified'
    return { ...acc, [value]: (acc[value] || 0) + 1 }
  }, {})

  return {
    session: sessionId(),
    condition: condition(),
    conditionOrder: conditionOrder(),
    phase: phase(),
    task_started_at: taskStartedAt(),
    events: log.length,
    tutorial: {
      events: tutorialEvents.length,
      edits: tutorialEvents.filter((e) => e.type === 'edit').length,
      generates: tutorialEvents.filter((e) => e.type === 'panel_generate').length,
    },
    afterTask: {
      events: afterEvents.length,
      edits: afterEvents.filter((e) => e.type === 'edit').length,
    },
    edits: {
      total: edits.length,
      byLevel: count(edits, 'level'),
      byAction: count(edits, 'action'),
      beyondPanelRatio: edits.length
        ? edits.filter((e) => e.beyondPanel).length / edits.length
        : 0,
    },
    regeneration: {
      total: generates.length,
      repeats: generates.filter((e) => e.repeat).length,
      byPanel: count(generates, 'target'),
      shareOfAllRevisions: (edits.length + generates.length)
        ? generates.length / (edits.length + generates.length)
        : 0,
    },
  }
}

/** 세션을 파일로 내보낸다. */
export const exportLog = ({ finalSnapshot = null, metadata = {} } = {}) => {
  const log = readLog()
  const payload = {
    schema_version: '2.0',
    exported_at: new Date().toISOString(),
    metadata: {
      session_id: sessionId(),
      condition: condition(),
      condition_order: conditionOrder(),
      tool: 'baseline',
      ...metadata,
    },
    summary: summarize(log),
    events: log,
    final_snapshot: finalSnapshot,
  }
  writeJSON(EXPORTED_KEY, Date.now())
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `baseline-${sessionId()}.json`
  link.click()
  URL.revokeObjectURL(url)
  return payload
}

export const resetLog = () => {
  try {
    [STORAGE_KEY, SESSION_KEY, CONDITION_KEY, ORDER_KEY,
      PHASE_KEY, TASK_START_KEY, EXPORTED_KEY, UPLOADED_KEY]
      .forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // 못 지워도 앱은 계속 돌아간다.
  }
}
