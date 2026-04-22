import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import './App.css'
import { type Database, getSupabaseClient, isSupabaseConfigured } from './lib/supabase'
import { hashPin } from './lib/pin'

type RecordRow = Database['public']['Tables']['hh_records']['Row']

type EditDraft = {
  record_date: string
  location: string
  therapist: string
  course: string
  amount: string
  balance: string
  memo: string
}

const AUTH_STORAGE_KEY = 'healinghands.remembered-auth'
const PIN_HASH_STORAGE_KEY = 'healinghands.pin-hash'
const DEFAULT_PIN = '1234'
const SETTINGS_ROW_ID = 'global'
const MEMO_TRUNCATE_THRESHOLD = 100

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

function todayDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isoToKorean(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}. ${mm}. ${dd} (${weekday})`
}

function koreanToIso(korean: string): string | null {
  const match = korean.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/)
  if (!match) return null
  const [, y, m, d] = match
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function formatCommas(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''
  return parseInt(digits, 10).toLocaleString('ko-KR')
}

function shouldTruncateMemo(memo: string): boolean {
  return memo.length > MEMO_TRUNCATE_THRESHOLD || (memo.match(/\n/g) ?? []).length >= 3
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function HandsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function App() {
  // ── Auth state ──
  const [isCheckingRememberedAuth, setIsCheckingRememberedAuth] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [pin, setPin] = useState('')
  const [rememberDevice, setRememberDevice] = useState(false)
  const [authError, setAuthError] = useState('')

  // ── PIN change ──
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [currentPinInput, setCurrentPinInput] = useState('')
  const [newPinInput, setNewPinInput] = useState('')
  const [pinChangeError, setPinChangeError] = useState('')

  // ── Records ──
  const [records, setRecords] = useState<RecordRow[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [recordsError, setRecordsError] = useState('')
  const [toastMessage, setToastMessage] = useState('')

  // ── New record modal ──
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formDate, setFormDate] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formTherapist, setFormTherapist] = useState('')
  const [formCourse, setFormCourse] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formBalance, setFormBalance] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // ── Inline edit ──
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({
    record_date: '',
    location: '',
    therapist: '',
    course: '',
    amount: '',
    balance: '',
    memo: '',
  })
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Expand memo ──
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Helpers ──

  function showToast(msg: string) {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2800)
  }

  async function getPinHash(): Promise<string> {
    const stored = localStorage.getItem(PIN_HASH_STORAGE_KEY)
    if (stored) return stored

    if (isSupabaseConfigured()) {
      try {
        const sb = getSupabaseClient()
        const { data } = await sb
          .from('hh_app_settings')
          .select('pin_hash')
          .eq('id', SETTINGS_ROW_ID)
          .maybeSingle()
        if (data?.pin_hash) {
          localStorage.setItem(PIN_HASH_STORAGE_KEY, data.pin_hash)
          return data.pin_hash
        }
      } catch {
        // fall through to default
      }
    }

    const defaultHash = await hashPin(DEFAULT_PIN)
    return defaultHash
  }

  // ── Check remembered auth ──
  useEffect(() => {
    void (async () => {
      try {
        const remembered = localStorage.getItem(AUTH_STORAGE_KEY)
        if (remembered) {
          const storedHash = await getPinHash()
          if (remembered === storedHash) {
            setIsAuthenticated(true)
          } else {
            localStorage.removeItem(AUTH_STORAGE_KEY)
          }
        }
      } finally {
        setIsCheckingRememberedAuth(false)
      }
    })()
  }, [])

  // ── Load records ──
  const loadRecords = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setRecords([])
      return
    }
    setIsLoadingRecords(true)
    setRecordsError('')
    try {
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from('hh_records')
        .select('*')
        .order('record_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      setRecords(data ?? [])
    } catch (err) {
      setRecordsError(getErrorMessage(err))
    } finally {
      setIsLoadingRecords(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      void loadRecords()
    }
  }, [isAuthenticated, loadRecords])

  // ── Auth handlers ──

  function handlePinDigits(
    setter: (v: string) => void,
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setter(val)
  }

  async function handlePinSubmit(e: FormEvent) {
    e.preventDefault()
    setAuthError('')
    const hash = await hashPin(pin)
    const storedHash = await getPinHash()
    if (hash === storedHash) {
      if (rememberDevice) {
        localStorage.setItem(AUTH_STORAGE_KEY, hash)
      }
      setIsAuthenticated(true)
      setPin('')
    } else {
      setAuthError('PIN이 맞지 않아요.')
      setPin('')
    }
  }

  async function handlePinChangeSave() {
    setPinChangeError('')
    const currentHash = await hashPin(currentPinInput)
    const storedHash = await getPinHash()
    if (currentHash !== storedHash) {
      setPinChangeError('현재 PIN이 맞지 않아요.')
      return
    }
    if (newPinInput.length !== 4) {
      setPinChangeError('새 PIN은 4자리여야 해요.')
      return
    }
    const newHash = await hashPin(newPinInput)
    localStorage.setItem(PIN_HASH_STORAGE_KEY, newHash)
    if (isSupabaseConfigured()) {
      try {
        const sb = getSupabaseClient()
        await sb
          .from('hh_app_settings')
          .upsert({ id: SETTINGS_ROW_ID, pin_hash: newHash, updated_at: new Date().toISOString() })
      } catch {
        // local-only update is fine
      }
    }
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsChangingPin(false)
    setCurrentPinInput('')
    setNewPinInput('')
    setPinChangeError('')
    showToast('PIN이 변경됐어요.')
  }

  function handleLock() {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsAuthenticated(false)
    setPin('')
    setAuthError('')
  }

  // ── Modal handlers ──

  function openModal() {
    setFormDate(isoToKorean(todayDateString()))
    setFormLocation('')
    setFormTherapist('')
    setFormCourse('')
    setFormAmount('')
    setFormBalance('')
    setFormMemo('')
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
  }

  async function handleSaveRecord(e: FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    try {
      const isoDate = koreanToIso(formDate) ?? todayDateString()
      const record = {
        record_date: isoDate,
        location: formLocation.trim(),
        therapist: formTherapist.trim(),
        course: formCourse.trim(),
        amount: formAmount.trim(),
        balance: formBalance.trim(),
        memo: formMemo.trim(),
      }

      if (isSupabaseConfigured()) {
        const sb = getSupabaseClient()
        const { error } = await sb.from('hh_records').insert(record)
        if (error) throw error
        await loadRecords()
      } else {
        const newRecord: RecordRow = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          ...record,
        }
        setRecords((prev) => [newRecord, ...prev])
      }
      closeModal()
      showToast('기록이 저장됐어요.')
    } catch (err) {
      showToast(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  // ── Edit handlers ──

  function startEdit(record: RecordRow) {
    setEditingId(record.id)
    setEditDraft({
      record_date: isoToKorean(record.record_date),
      location: record.location,
      therapist: record.therapist,
      course: record.course,
      amount: record.amount,
      balance: record.balance,
      memo: record.memo,
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    setIsEditSaving(true)
    try {
      const isoDate = koreanToIso(editDraft.record_date) ?? todayDateString()
      const update = {
        record_date: isoDate,
        location: editDraft.location.trim(),
        therapist: editDraft.therapist.trim(),
        course: editDraft.course.trim(),
        amount: editDraft.amount.trim(),
        balance: editDraft.balance.trim(),
        memo: editDraft.memo.trim(),
      }

      if (isSupabaseConfigured()) {
        const sb = getSupabaseClient()
        const { error } = await sb.from('hh_records').update(update).eq('id', id)
        if (error) throw error
        await loadRecords()
      } else {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, ...update } : r,
          ),
        )
      }
      setEditingId(null)
      showToast('수정됐어요.')
    } catch (err) {
      showToast(getErrorMessage(err))
    } finally {
      setIsEditSaving(false)
    }
  }

  async function deleteRecord(id: string) {
    if (!window.confirm('이 기록을 삭제할까요?')) return
    setDeletingId(id)
    try {
      if (isSupabaseConfigured()) {
        const sb = getSupabaseClient()
        const { error } = await sb.from('hh_records').delete().eq('id', id)
        if (error) throw error
        await loadRecords()
      } else {
        setRecords((prev) => prev.filter((r) => r.id !== id))
      }
      showToast('삭제됐어요.')
    } catch (err) {
      showToast(getErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // ─── Render: loading ───────────────────────────────────────────────────────

  if (isCheckingRememberedAuth) {
    return (
      <div className="auth-shell">
        <div className="pin-card">
          <p className="pin-subtitle">Healing Hands를 준비하는 중...</p>
        </div>
      </div>
    )
  }

  // ─── Render: login ─────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <form className="pin-card" onSubmit={handlePinSubmit}>
          {isChangingPin ? (
            <>
              <h1>PIN 변경하기</h1>
              <div className="pin-change-panel">
                <label className="field">
                  <span>현재 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="현재 PIN"
                    value={currentPinInput}
                    onChange={(e) => handlePinDigits(setCurrentPinInput, e)}
                  />
                </label>
                <label className="field">
                  <span>새 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="새 PIN"
                    value={newPinInput}
                    onChange={(e) => handlePinDigits(setNewPinInput, e)}
                  />
                </label>
                {pinChangeError ? <p className="error-text">{pinChangeError}</p> : null}
                <button type="button" className="secondary-button" onClick={() => void handlePinChangeSave()}>
                  PIN 저장
                </button>
                <button type="button" className="text-button" onClick={() => setIsChangingPin(false)}>
                  로그인으로 돌아가기
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="app-badge">
                <HandsIcon />
                <span>Healing Hands</span>
              </div>
              <div className="pin-entry-field">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  aria-label="4자리 숫자 입력"
                  value={pin}
                  onChange={(e) => handlePinDigits(setPin, e)}
                  className="pin-entry-input"
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                <span>이 기기 기억하기</span>
              </label>
              {authError ? <p className="error-text">{authError}</p> : null}
              <button type="submit" className="primary-button">
                입장하기
              </button>
              <button
                type="button"
                className="text-button pin-change-button"
                onClick={() => {
                  setIsChangingPin(true)
                  setPinChangeError('')
                  setCurrentPinInput('')
                  setNewPinInput('')
                }}
              >
                PIN 변경하기
              </button>
            </>
          )}
        </form>
      </div>
    )
  }

  // ─── Render: main ──────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">
          <div className="app-icon">
            <HandsIcon />
          </div>
          <h1>Healing Hands</h1>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="record-icon-button lock-button"
            onClick={handleLock}
            aria-label="잠금"
          >
            <LockIcon />
          </button>
        </div>
      </div>

      {/* Toast */}
      {toastMessage && <div className="toast-message">{toastMessage}</div>}

      {/* Notice: no Supabase */}
      {!isSupabaseConfigured() && (
        <div className="notice-card">
          <h2>Supabase 미연결</h2>
          <p>.env 파일에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하면 데이터가 클라우드에 저장돼요. 지금은 이 기기 메모리에만 임시 저장됩니다.</p>
        </div>
      )}

      {/* Records error */}
      {recordsError && (
        <div className="notice-card error-card">
          <p>{recordsError}</p>
        </div>
      )}

      {/* Content */}
      <div className="content-area">
        {isLoadingRecords ? (
          <div className="empty-state">
            <p>불러오는 중...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-illustration">
              <HandsIcon />
            </div>
            <h2>아직 기록이 없어요</h2>
            <p>오른쪽 아래 + 버튼으로 첫 기록을 남겨보세요.</p>
          </div>
        ) : (
          <div className="record-list">
            {records.map((record) =>
              editingId === record.id ? (
                <InlineEditForm
                  key={record.id}
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSave={() => void saveEdit(record.id)}
                  onCancel={cancelEdit}
                  isSaving={isEditSaving}
                />
              ) : (
                <RecordCard
                  key={record.id}
                  record={record}
                  isExpanded={expandedIds.has(record.id)}
                  onToggleExpand={() => toggleExpand(record.id)}
                  onEdit={() => startEdit(record)}
                  onDelete={() => void deleteRecord(record.id)}
                  isDeleting={deletingId === record.id}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* FAB */}
      <button type="button" className="fab" onClick={openModal} aria-label="새 기록 추가">
        <PlusIcon />
      </button>

      {/* New record modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-sheet">
            <div className="modal-header">
              <p className="modal-title">새 기록</p>
              <button type="button" className="modal-close-button" onClick={closeModal} aria-label="닫기">
                <XIcon />
              </button>
            </div>
            <form className="record-form" onSubmit={handleSaveRecord}>
              {/* 날짜 */}
              <div className="form-row form-row--single">
                <label className="field">
                  <span>날짜</span>
                  <input
                    type="text"
                    placeholder="2026. 04. 22 (수)"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </label>
              </div>
              {/* 어디서 / 누가 */}
              <div className="form-row">
                <label className="field">
                  <span>어디서</span>
                  <input
                    type="text"
                    placeholder="장소"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>누가</span>
                  <input
                    type="text"
                    placeholder="담당자"
                    value={formTherapist}
                    onChange={(e) => setFormTherapist(e.target.value)}
                  />
                </label>
              </div>
              {/* 코스 */}
              <div className="form-row form-row--single">
                <label className="field">
                  <span>코스</span>
                  <input
                    type="text"
                    placeholder="받은 코스"
                    value={formCourse}
                    onChange={(e) => setFormCourse(e.target.value)}
                  />
                </label>
              </div>
              {/* 금액 / 잔액 */}
              <div className="form-row">
                <label className="field">
                  <span>금액</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formAmount}
                    onChange={(e) => setFormAmount(formatCommas(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>잔액</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formBalance}
                    onChange={(e) => setFormBalance(formatCommas(e.target.value))}
                  />
                </label>
              </div>
              {/* 메모 */}
              <div className="form-row form-row--single">
                <label className="field">
                  <span>메모</span>
                  <textarea
                    className="field-textarea"
                    placeholder="메모를 입력하세요"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    rows={3}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary-button save-button" disabled={isSaving}>
                  {isSaving ? '저장 중...' : '저장하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── RecordCard ───────────────────────────────────────────────────────────────

function RecordCard({
  record,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  isDeleting,
}: {
  record: RecordRow
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const hasMemo = Boolean(record.memo?.trim())
  const memoNeedsClamp = hasMemo && shouldTruncateMemo(record.memo)

  return (
    <div className="record-outer">
      <div className="record-body-surface">
        {/* Header: 어디서(타이틀) + [날짜 · 수정 · 삭제] */}
        <div className="record-date-header">
          <p className="record-header-title">
            {record.location ? record.location : '기록'}
          </p>
          <div className="record-date-actions">
            <span className="record-date-inline">{isoToKorean(record.record_date)}</span>
            <button
              type="button"
              className="record-icon-button record-icon-button--header"
              onClick={onEdit}
              aria-label="수정"
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className="record-icon-button record-icon-button--header"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="삭제"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Body: 1열 = 누가/코스/금액/잔액, 2열 = 메모 */}
        <div className="record-body">
          {/* 1열 */}
          <div className="record-col record-col--meta">
            {(record.therapist || record.course) && (
              <div className="record-field">
                <span className="record-field-value">
                  {record.course}
                  {record.course && record.therapist && (
                    <span className="record-field-value--paren"> ({record.therapist})</span>
                  )}
                  {!record.course && record.therapist && record.therapist}
                </span>
              </div>
            )}
            {(record.amount || record.balance) && <hr className="record-divider" />}
            {record.amount && (
              <div className="record-field">
                <span className="record-field-label">금액</span>
                <span className="record-field-value">{record.amount}원</span>
              </div>
            )}
            {record.balance && (
              <div className="record-field">
                <span className="record-field-label">잔액</span>
                <span className="record-field-value">{record.balance}원</span>
              </div>
            )}
          </div>

          {/* 2열: 메모 */}
          <div className={`record-col record-col--content${hasMemo ? '' : ' record-col--content-empty'}`}>
            {hasMemo && (
              <div className="record-memo-wrap">
                <p className={`record-memo${memoNeedsClamp && !isExpanded ? ' record-memo--clamped' : ''}`}>
                  {record.memo}
                </p>
                {memoNeedsClamp && (
                  <button type="button" className="expand-button" onClick={onToggleExpand}>
                    {isExpanded ? '접기' : '더보기'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── InlineEditForm ───────────────────────────────────────────────────────────

function InlineEditForm({
  draft,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  draft: EditDraft
  onChange: (d: EditDraft) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft.memo])

  function set(key: keyof EditDraft) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...draft, [key]: e.target.value })
  }

  function setAmount(key: 'amount' | 'balance') {
    return (e: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...draft, [key]: formatCommas(e.target.value) })
  }

  return (
    <div className="record-outer">
      <div className="record-body-surface">
        <div className="record-edit-form">
          {/* 날짜 / 어디서 */}
          <div className="edit-form-row">
            <div className="edit-field">
              <span className="edit-form-label">날짜</span>
              <input
                className="record-edit-input"
                type="text"
                placeholder="2026. 04. 22 (수)"
                value={draft.record_date}
                onChange={set('record_date')}
              />
            </div>
            <div className="edit-field">
              <span className="edit-form-label">어디서</span>
              <input
                className="record-edit-input"
                type="text"
                placeholder="장소"
                value={draft.location}
                onChange={set('location')}
              />
            </div>
          </div>
          {/* 누가 / 코스 */}
          <div className="edit-form-row">
            <div className="edit-field">
              <span className="edit-form-label">누가</span>
              <input
                className="record-edit-input"
                type="text"
                placeholder="담당자"
                value={draft.therapist}
                onChange={set('therapist')}
              />
            </div>
            <div className="edit-field">
              <span className="edit-form-label">코스</span>
              <input
                className="record-edit-input"
                type="text"
                placeholder="받은 코스"
                value={draft.course}
                onChange={set('course')}
              />
            </div>
          </div>
          {/* 금액 / 잔액 */}
          <div className="edit-form-row">
            <div className="edit-field">
              <span className="edit-form-label">금액</span>
              <input
                className="record-edit-input"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={draft.amount}
                onChange={setAmount('amount')}
              />
            </div>
            <div className="edit-field">
              <span className="edit-form-label">잔액</span>
              <input
                className="record-edit-input"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={draft.balance}
                onChange={setAmount('balance')}
              />
            </div>
          </div>
          {/* 메모 */}
          <div className="edit-field">
            <span className="edit-form-label">메모</span>
            <textarea
              ref={textareaRef}
              className="record-edit-textarea"
              placeholder="메모를 입력하세요"
              value={draft.memo}
              onChange={set('memo')}
            />
          </div>
          <div className="edit-actions">
            <button type="button" className="edit-cancel-button" onClick={onCancel}>
              취소
            </button>
            <button type="button" className="edit-save-button" onClick={onSave} disabled={isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
