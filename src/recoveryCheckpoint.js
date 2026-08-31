const DATABASE_NAME = 'scenelens-recovery-v1'
const STORE_NAME = 'checkpoints'

export const BASELINE_CHECKPOINT_KEY = 'baseline-workspace'

let databasePromise = null
let writeQueue = Promise.resolve()
let checkpointingPaused = false

export const pauseCheckpointing = () => { checkpointingPaused = true }

const openDatabase = () => {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result || null)
  request.onerror = () => reject(request.error)
})

const dataOnly = (state = {}) => Object.fromEntries(
  Object.entries(state).filter(([, value]) => typeof value !== 'function'),
)

export const readCheckpoint = async (key, slot = 'current') => {
  if (typeof window === 'undefined' || !window.indexedDB) return null
  try {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    return await requestValue(transaction.objectStore(STORE_NAME).get(`${key}:${slot}`))
  } catch (error) {
    console.warn('[recovery] checkpoint read skipped', error)
    return null
  }
}

const writeCheckpoint = async (key, state) => {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const current = await requestValue(store.get(`${key}:current`))
  if (current) store.put(current, `${key}:previous`)
  store.put({ version: 1, savedAt: Date.now(), state: dataOnly(state) }, `${key}:current`)
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export const saveCheckpoint = (key, state) => {
  if (checkpointingPaused || typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(false)
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => writeCheckpoint(key, state))
    .then(() => true)
    .catch((error) => {
      console.warn('[recovery] checkpoint save skipped', error)
      return false
    })
  return writeQueue
}

export const promotePreviousCheckpoint = async (key) => {
  const previous = await readCheckpoint(key, 'previous')
  if (!previous) return false
  try {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(previous, `${key}:current`)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return true
  } catch (error) {
    console.warn('[recovery] previous checkpoint restore skipped', error)
    return false
  }
}

export const clearCheckpoints = async (key) => {
  if (typeof window === 'undefined' || !window.indexedDB) return
  try {
    await writeQueue.catch(() => {})
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.delete(`${key}:current`)
    store.delete(`${key}:previous`)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch (error) {
    console.warn('[recovery] checkpoint clear skipped', error)
  }
}
