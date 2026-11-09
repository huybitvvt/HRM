import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSearchParams } from 'react-router-dom'
import LeaveSettingsPanel from '../components/LeaveSettingsPanel'
import { fbGet, fbUpdate } from '../services/firebase'
import { supabase } from '../services/supabase'
import { getCompanyIdForUser } from '../utils/companyContext'
import {
  ATTENDANCE_SHIFT_IDS,
  buildAttendanceShiftSettingsPayload,
  getAttendanceShiftOptions,
  normalizeAttendanceShiftSettings
} from '../utils/attendanceShift'
import {
  fetchCurrentNetworkStatus,
  normalizeWifiAttendanceSettings,
  parseAllowedIpsInput
} from '../utils/attendanceWifi'
import {
  createPenaltyCategory,
  DEFAULT_PENALTY_CATEGORIES,
  normalizePenaltyCategories
} from '../utils/attendancePenalties'
import './HolidaySettings.css'

const TABS = [
  { id: 'holidays', label: 'Cài đặt ngày lễ', icon: 'fas fa-calendar-day' },
  { id: 'shifts', label: 'Cài đặt ca', icon: 'fas fa-clock' },
  { id: 'wifi', label: 'Chấm công Wi-Fi', icon: 'fas fa-wifi' },
  { id: 'penalties', label: 'Cài đặt Nội dung phạt và mức phạt', icon: 'fas fa-file-invoice-dollar' },
  { id: 'leave', label: 'Cài đặt phép', icon: 'fas fa-calendar-alt' }
]

const TAB_COPY = {
  holidays: 'Khai báo ngày lễ/ngày nghỉ để hiển thị chính xác trên Bảng Công.',
  shifts: 'Cài giờ chuẩn từng ca. Báo cáo đi muộn/về sớm dùng ca của từng nhân viên.',
  wifi: 'Đăng ký IP mạng Wi-Fi văn phòng/bưu cục để nhân viên chấm công online bằng mạng công ty.',
  penalties: 'Mức phạt dùng khi nạp Bảng phạt từ chấm công. Muộn/sớm: 2 lần đầu mỗi lần <15p miễn phạt; từ lần 3 hoặc có lần ≥15p thì tổng <30p phạt 50.000đ, ≥30p phạt 100.000đ. Công chỉ trừ khi muộn+sớm ≥60 phút trong ngày.',
  leave: 'Thiết lập tổng số ngày phép năm cho mỗi nhân sự.'
}

const EMPTY_WIFI_FORM = {
  id: '',
  name: '',
  ssid: '',
  address: '',
  allowedIpsText: '',
  isActive: true
}

const sortHolidays = holidays => [...(holidays || [])]
  .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '')))
  .sort((left, right) => left.date.localeCompare(right.date))

function HolidaySettings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const companyId = useMemo(() => getCompanyIdForUser(user), [user])
  const leaveCompanyId = user?.company_id || user?.companyId || companyId
  const canEditLeave = user?.role === 'admin' || user?.role === 'hr'
  const requestedTab = searchParams.get('tab')
  const activeTab = requestedTab === 'leave' && !canEditLeave ? 'holidays' :
    TABS.some(tab => tab.id === requestedTab) ? requestedTab : 'holidays'
  const setActiveTab = tab => setSearchParams(tab === 'holidays' ? {} : { tab })
  const [settings, setSettings] = useState(() => normalizeAttendanceShiftSettings())
  const [penaltyCategories, setPenaltyCategories] = useState(() =>
    DEFAULT_PENALTY_CATEGORIES.map(item => ({ ...item }))
  )
  const [selectedShiftId, setSelectedShiftId] = useState(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE)
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')
  const [wifiForm, setWifiForm] = useState(EMPTY_WIFI_FORM)
  const [editingWifiId, setEditingWifiId] = useState(null)
  const [networkInfo, setNetworkInfo] = useState({ ip: null, isPublic: false, matchedLocation: null })
  const [detectingIp, setDetectingIp] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const stored = await fbGet('hr/attendanceSettings/default', companyId)
      const nextSettings = normalizeAttendanceShiftSettings(stored)
      setSettings(nextSettings)
      setPenaltyCategories(normalizePenaltyCategories(stored?.penaltyCategories))
      setSelectedShiftId(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE)
    } catch (requestError) {
      setError(requestError.message || 'Không tải được cài đặt.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const refreshWifiNetwork = useCallback(async (wifiConfig = settings.wifiAttendance) => {
    setDetectingIp(true)
    try {
      const status = await fetchCurrentNetworkStatus(wifiConfig, { supabase })
      setNetworkInfo(status)
      return status
    } finally {
      setDetectingIp(false)
    }
  }, [settings.wifiAttendance])

  useEffect(() => {
    if (activeTab === 'wifi') {
      refreshWifiNetwork(settings.wifiAttendance)
    }
  }, [activeTab, refreshWifiNetwork, settings.wifiAttendance])

  const wifiAttendance = useMemo(
    () => normalizeWifiAttendanceSettings(settings.wifiAttendance),
    [settings.wifiAttendance]
  )

  const updateWifiSettings = updater => {
    setNotice('')
    setSettings(current => {
      const currentWifi = normalizeWifiAttendanceSettings(current.wifiAttendance)
      const nextWifi = typeof updater === 'function' ? updater(currentWifi) : updater
      return {
        ...current,
        wifiAttendance: normalizeWifiAttendanceSettings(nextWifi)
      }
    })
  }

  const handleCaptureCurrentIp = async () => {
    setError('')
    setNotice('')
    const status = await refreshWifiNetwork(settings.wifiAttendance)
    if (!status.ip || !status.isPublic) {
      setError('Chưa nhận được IP public của mạng hiện tại (môi trường local loopback). Khi chạy trên hệ thống triển khai hoặc qua mạng Internet văn phòng, nút này sẽ tự động lấy IP public của Wi-Fi.')
      return
    }
    setWifiForm(prev => ({ ...prev, allowedIpsText: status.ip }))
    setNotice(`Đã điền IP mạng hiện tại (${status.ip}). Hãy kiểm tra tên điểm Wi-Fi rồi bấm Thêm/Cập nhật và Lưu cài đặt.`)
  }

  const handleUpsertWifiLocation = () => {
    setError('')
    setNotice('')
    const cleanName = wifiForm.name.trim()
    if (!cleanName) {
      setError('Vui lòng nhập tên điểm Wi-Fi văn phòng (ví dụ: Bưu cục Hà Nội).')
      return
    }
    const parsedIps = parseAllowedIpsInput(wifiForm.allowedIpsText)
    if (parsedIps.invalidEntries.length > 0) {
      setError(`IP/dải mạng không hợp lệ hoặc không phải IP public: ${parsedIps.invalidEntries.join(', ')}`)
      return
    }
    if (parsedIps.validEntries.length === 0) {
      setError('Vui lòng nhập ít nhất 1 địa chỉ IP public hoặc bấm "Lấy IP mạng hiện tại".')
      return
    }

    const locationId = editingWifiId || wifiForm.id || `wifi_${Date.now().toString(36)}`
    const nextItem = {
      id: locationId,
      name: cleanName,
      ssid: wifiForm.ssid.trim(),
      address: wifiForm.address.trim(),
      allowedIps: parsedIps.validEntries,
      isActive: wifiForm.isActive !== false
    }

    updateWifiSettings(current => {
      const exists = current.locations.some(item => item.id === locationId)
      const nextLocations = exists
        ? current.locations.map(item => (item.id === locationId ? nextItem : item))
        : [...current.locations, nextItem]
      return {
        ...current,
        enabled: true,
        locations: nextLocations
      }
    })

    setWifiForm(EMPTY_WIFI_FORM)
    setEditingWifiId(null)
    setNotice(`Đã ${editingWifiId ? 'cập nhật' : 'thêm'} điểm Wi-Fi "${cleanName}". Bấm "Lưu cài đặt" ở góc trên để áp dụng.`)
  }

  const handleEditWifiLocation = location => {
    setError('')
    setNotice('')
    setEditingWifiId(location.id)
    setWifiForm({
      id: location.id,
      name: location.name || '',
      ssid: location.ssid || '',
      address: location.address || '',
      allowedIpsText: (location.allowedIps || []).join('\n'),
      isActive: location.isActive !== false
    })
  }

  const handleRemoveWifiLocation = id => {
    setError('')
    setNotice('')
    updateWifiSettings(current => ({
      ...current,
      locations: current.locations.filter(item => item.id !== id)
    }))
    if (editingWifiId === id) {
      setEditingWifiId(null)
      setWifiForm(EMPTY_WIFI_FORM)
    }
  }

  const holidays = sortHolidays(settings.holidays)
  const shiftOptions = getAttendanceShiftOptions(settings)
  const selectedShift = settings.shifts[selectedShiftId]

  const addHoliday = () => {
    setError('')
    setNotice('')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
      setError('Vui lòng chọn ngày lễ.')
      return
    }
    setSettings(current => ({
      ...current,
      holidays: sortHolidays([
        ...(current.holidays || []).filter(item => item.date !== holidayDate),
        { date: holidayDate, name: holidayName.trim() }
      ])
    }))
    setHolidayDate('')
    setHolidayName('')
  }

  const removeHoliday = date => {
    setNotice('')
    setSettings(current => ({
      ...current,
      holidays: (current.holidays || []).filter(item => item.date !== date)
    }))
  }

  const updateSelectedShift = (field, value) => {
    setNotice('')
    setSettings(current => ({
      ...current,
      shifts: {
        ...current.shifts,
        [selectedShiftId]: {
          ...current.shifts[selectedShiftId],
          [field]: value
        }
      }
    }))
  }

  const addShift = () => {
    const id = `custom_${crypto.randomUUID()}`
    setSettings(current => ({
      ...current,
      shifts: {
        ...current.shifts,
        [id]: {
          id,
          name: '',
          standardCheckIn: '08:00',
          standardCheckOut: '17:00',
          splitShift: { enabled: false }
        }
      }
    }))
    setSelectedShiftId(id)
    setError('')
    setNotice('Đã thêm ca mới. Nhập tên, chọn khung giờ rồi bấm Lưu cài đặt.')
  }

  const toggleSelectedSplitShift = enabled => {
    setSettings(current => {
      const shift = current.shifts[selectedShiftId]
      const splitShift = shift.splitShift || {}
      const defaultSessions = selectedShiftId === ATTENDANCE_SHIFT_IDS.SALE_MORNING
        ? { morningEnd: '08:00', afternoonStart: '09:30' }
        : { morningEnd: '12:00', afternoonStart: '13:00' }
      return {
        ...current,
        shifts: {
          ...current.shifts,
          [selectedShiftId]: {
            ...shift,
            splitShift: {
              ...splitShift,
              enabled,
              morning: {
                start: splitShift.morning?.start || shift.standardCheckIn || '',
                end: splitShift.morning?.end || defaultSessions.morningEnd,
                workdays: splitShift.morning?.workdays ?? 0.5
              },
              afternoon: {
                start: splitShift.afternoon?.start || defaultSessions.afternoonStart,
                end: splitShift.afternoon?.end || shift.standardCheckOut || '',
                workdays: splitShift.afternoon?.workdays ?? 0.5
              }
            }
          }
        }
      }
    })
  }

  const updateSelectedSplitSession = (session, field, value) => {
    setSettings(current => {
      const shift = current.shifts[selectedShiftId]
      return {
        ...current,
        shifts: {
          ...current.shifts,
          [selectedShiftId]: {
            ...shift,
            splitShift: {
              ...(shift.splitShift || {}),
              [session]: {
                ...(shift.splitShift?.[session] || {}),
                [field]: value
              }
            }
          }
        }
      }
    })
  }

  const updatePenaltyCategory = (key, field, value) => {
    setNotice('')
    setPenaltyCategories(current => current.map(item => (
      item.key === key ? { ...item, [field]: value } : item
    )))
  }

  const addPenaltyCategory = () => {
    setNotice('')
    setPenaltyCategories(current => [
      ...current,
      createPenaltyCategory({ label: '', amount: 0 })
    ])
  }

  const removePenaltyCategory = key => {
    setNotice('')
    setPenaltyCategories(current => current.length <= 1 ? current : current.filter(item => item.key !== key))
  }

  const resetPenaltyCategories = () => {
    setNotice('')
    setPenaltyCategories(DEFAULT_PENALTY_CATEGORIES.map(item => ({ ...item })))
  }

  const saveSettings = async () => {
    const shifts = Object.values(settings.shifts)
    const invalidDetails = shifts.find(shift =>
      !shift.name?.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.standardCheckIn || '') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.standardCheckOut || '')
    )
    const duplicateName = shifts.find((shift, index) => shifts.slice(0, index).some(other =>
      other.name.trim().toLocaleLowerCase('vi') === shift.name.trim().toLocaleLowerCase('vi')
    ))
    if (invalidDetails || duplicateName) {
      setSelectedShiftId((invalidDetails || duplicateName).id)
      setActiveTab('shifts')
      setError(invalidDetails ? 'Vui lòng nhập tên ca và đầy đủ giờ vào, giờ ra.' : 'Tên ca đã tồn tại. Vui lòng chọn tên khác.')
      setNotice('')
      return
    }
    const invalidShift = getAttendanceShiftOptions(settings).find(
      shift => shift.standardCheckIn === shift.standardCheckOut
    )
    if (invalidShift) {
      setSelectedShiftId(invalidShift.id)
      setActiveTab('shifts')
      setError(`Giờ ra chuẩn của ${invalidShift.name} phải khác giờ vào chuẩn.`)
      setNotice('')
      return
    }

    const invalidSplitShift = getAttendanceShiftOptions(settings).find(shift => {
      if (!shift.splitShift?.enabled) return false
      const sessions = [shift.splitShift.morning, shift.splitShift.afternoon]
      return sessions.some(session =>
        !session?.start || !session?.end || session.start >= session.end ||
        Number(session.workdays) <= 0 || Number(session.workdays) > 1
      ) ||
        sessions[0]?.end > sessions[1]?.start ||
        sessions.reduce((sum, session) => sum + Number(session.workdays || 0), 0) > 1
    })
    if (invalidSplitShift) {
      setSelectedShiftId(invalidSplitShift.id)
      setActiveTab('shifts')
      setError(`Vui lòng kiểm tra giờ và mức công hai buổi của ${invalidSplitShift.name}. Tổng hai buổi không được vượt quá 1 công.`)
      setNotice('')
      return
    }

    const normalizedPenalties = normalizePenaltyCategories(penaltyCategories)
    const emptyPenalty = normalizedPenalties.find(item => !item.label.trim())
    if (emptyPenalty) {
      setActiveTab('penalties')
      setError('Vui lòng nhập nội dung phạt cho mọi hạng mục.')
      setNotice('')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      let nextWifiAttendance = normalizeWifiAttendanceSettings(settings.wifiAttendance)
      if (wifiForm.name.trim() || wifiForm.allowedIpsText.trim()) {
        const cleanName = wifiForm.name.trim()
        const parsedIps = parseAllowedIpsInput(wifiForm.allowedIpsText)
        if (!cleanName) {
          setActiveTab('wifi')
          setError('Bạn đang nhập dở điểm Wi-Fi nhưng chưa điền Tên điểm Wi-Fi.')
          setSaving(false)
          return
        }
        if (parsedIps.invalidEntries.length > 0 || parsedIps.validEntries.length === 0) {
          setActiveTab('wifi')
          setError(
            parsedIps.invalidEntries.length > 0
              ? `IP không hợp lệ hoặc không phải IP public: ${parsedIps.invalidEntries.join(', ')}`
              : 'Vui lòng nhập ít nhất 1 địa chỉ IP public cho điểm Wi-Fi đang điền.'
          )
          setSaving(false)
          return
        }
        const locationId = editingWifiId || wifiForm.id || `wifi_${Date.now().toString(36)}`
        const pendingItem = {
          id: locationId,
          name: cleanName,
          ssid: wifiForm.ssid.trim(),
          address: wifiForm.address.trim(),
          allowedIps: parsedIps.validEntries,
          isActive: wifiForm.isActive !== false
        }
        const exists = nextWifiAttendance.locations.some(item => item.id === locationId)
        nextWifiAttendance = normalizeWifiAttendanceSettings({
          ...nextWifiAttendance,
          enabled: true,
          locations: exists
            ? nextWifiAttendance.locations.map(item => (item.id === locationId ? pendingItem : item))
            : [...nextWifiAttendance.locations, pendingItem]
        })
        setWifiForm(EMPTY_WIFI_FORM)
        setEditingWifiId(null)
      }

      const payload = buildAttendanceShiftSettingsPayload({
        ...settings,
        wifiAttendance: nextWifiAttendance,
        holidays: sortHolidays(settings.holidays)
      })
      await fbUpdate('hr/attendanceSettings/default', {
        ...payload,
        penaltyCategories: normalizedPenalties
      }, companyId)
      setSettings(normalizeAttendanceShiftSettings(payload))
      setPenaltyCategories(normalizedPenalties)
      setNotice('Đã lưu cài đặt. Hãy tổng hợp lại Bảng Công nếu thay đổi ngày lễ hoặc ca.')
    } catch (requestError) {
      setError(requestError.message || 'Không lưu được cài đặt.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="holiday-settings-page">
      <header className="holiday-settings-head">
        <div>
          <h1>Cài đặt</h1>
          <p>{TAB_COPY[activeTab]}</p>
        </div>
        {activeTab !== 'leave' && <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={loading || saving}>
          <i className="fas fa-save"></i> {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
        </button>}
      </header>

      <div className="holiday-settings-tabs" role="tablist" aria-label="Cài đặt chấm công">
        {TABS.filter(tab => tab.id !== 'leave' || canEditLeave).map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`holiday-settings-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id)
              setError('')
              setNotice('')
            }}
          >
            <i className={tab.icon}></i>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab !== 'leave' && error && <div className="holiday-settings-alert is-error">{error}</div>}
      {activeTab !== 'leave' && notice && <div className="holiday-settings-alert is-success">{notice}</div>}

      {activeTab === 'leave' && <LeaveSettingsPanel companyId={leaveCompanyId} />}

      {activeTab === 'holidays' && (
        <section className="holiday-settings-card" role="tabpanel">
          <div className="holiday-settings-form">
            <label>
              <span>Ngày</span>
              <input type="date" value={holidayDate} onChange={event => setHolidayDate(event.target.value)} />
            </label>
            <label>
              <span>Tên ngày lễ</span>
              <input type="text" value={holidayName} onChange={event => setHolidayName(event.target.value)} placeholder="Ví dụ: Quốc khánh" />
            </label>
            <button type="button" className="btn" onClick={addHoliday} disabled={loading || !holidayDate}>
              <i className="fas fa-plus"></i> Thêm ngày lễ
            </button>
          </div>

          {loading ? (
            <div className="holiday-settings-empty">Đang tải cài đặt...</div>
          ) : holidays.length === 0 ? (
            <div className="holiday-settings-empty">Chưa khai báo ngày lễ.</div>
          ) : (
            <div className="holiday-settings-list">
              {holidays.map(item => (
                <div className="holiday-settings-item" key={item.date}>
                  <div>
                    <strong>{new Date(`${item.date}T00:00:00`).toLocaleDateString('vi-VN')}</strong>
                    <span>{item.name || 'Ngày lễ'}</span>
                  </div>
                  <button type="button" className="btn btn-icon" onClick={() => removeHoliday(item.date)} title="Xóa ngày lễ">
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'shifts' && (
        <section className="holiday-settings-card" role="tabpanel">
          {loading ? (
            <div className="holiday-settings-empty">Đang tải cài đặt...</div>
          ) : (
            <>
              <div className="holiday-settings-shift-pills">
                {shiftOptions.map(shift => (
                  <button
                    key={shift.id}
                    type="button"
                    className={`btn${selectedShiftId === shift.id ? ' btn-primary' : ''}`}
                    onClick={() => setSelectedShiftId(shift.id)}
                  >
                    {shift.name || 'Ca mới'} ({shift.standardCheckIn}–{shift.standardCheckOut})
                  </button>
                ))}
                <button type="button" className="btn" onClick={addShift} disabled={saving}>
                  <i className="fas fa-plus"></i> Thêm ca mới
                </button>
              </div>

              <div className="holiday-settings-grid holiday-settings-shift-fields">
                <label>
                  <span>Tên ca</span>
                  <input
                    type="text"
                    value={selectedShift?.name || ''}
                    onChange={event => updateSelectedShift('name', event.target.value)}
                  />
                </label>
                <label>
                  <span>Giờ vào chuẩn</span>
                  <input
                    type="time"
                    value={selectedShift?.standardCheckIn || ''}
                    onChange={event => updateSelectedShift('standardCheckIn', event.target.value)}
                  />
                </label>
                <label>
                  <span>Giờ ra chuẩn</span>
                  <input
                    type="time"
                    value={selectedShift?.standardCheckOut || ''}
                    onChange={event => updateSelectedShift('standardCheckOut', event.target.value)}
                  />
                </label>
              </div>

              <div className="holiday-settings-split-card">
                <label className="holiday-settings-check holiday-settings-split-toggle">
                  <input
                    type="checkbox"
                    checked={selectedShift?.splitShift?.enabled === true}
                    onChange={event => toggleSelectedSplitShift(event.target.checked)}
                  />
                  <span>
                    <strong>Bật chia ca thành 2 buổi</strong>
                    <small>Tính công theo giờ thực tế từng buổi, không tính giờ nghỉ giữa ca.</small>
                  </span>
                </label>

                {selectedShift?.splitShift?.enabled && (
                  <>
                    <div className="holiday-settings-session-grid">
                      {[
                        { key: 'morning', label: 'Buổi sáng' },
                        { key: 'afternoon', label: 'Buổi chiều' }
                      ].map(session => (
                        <div className="holiday-settings-session" key={session.key}>
                          <h3>{session.label}</h3>
                          <label>
                            <span>Bắt đầu</span>
                            <input
                              type="time"
                              value={selectedShift.splitShift[session.key]?.start || ''}
                              onChange={event => updateSelectedSplitSession(session.key, 'start', event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Kết thúc</span>
                            <input
                              type="time"
                              value={selectedShift.splitShift[session.key]?.end || ''}
                              onChange={event => updateSelectedSplitSession(session.key, 'end', event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Công tối đa</span>
                            <input
                              type="number"
                              min="0.01"
                              max="1"
                              step="0.05"
                              value={selectedShift.splitShift[session.key]?.workdays ?? 0.5}
                              onChange={event => updateSelectedSplitSession(
                                session.key,
                                'workdays',
                                Number(event.target.value)
                              )}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                    <p className="holiday-settings-split-note">
                      Đi muộn/về sớm giảm công theo tỷ lệ. Thiếu lượt chấm: dùng giờ vào đầu và ra cuối.
                    </p>
                  </>
                )}
              </div>

              <label className="holiday-settings-check">
                <input
                  type="checkbox"
                  checked={settings.overtime?.autoCalculate !== false}
                  onChange={event => setSettings(current => ({
                    ...current,
                    overtime: { ...(current.overtime || {}), autoCalculate: event.target.checked }
                  }))}
                />
                Tự động tính tăng ca sau 480 phút (tắt để HR nhập từ Excel)
              </label>
            </>
          )}
        </section>
      )}

      {activeTab === 'wifi' && (
        <section className="holiday-settings-card" role="tabpanel">
          {loading ? (
            <div className="holiday-settings-empty">Đang tải cài đặt...</div>
          ) : (
            <div className="holiday-wifi-panel">
              <div className={`holiday-wifi-status${networkInfo.matchedLocation ? ' is-matched' : ''}`}>
                <div>
                  <div className="holiday-wifi-status__title">
                    <i className="fas fa-wifi" aria-hidden="true"></i>
                    <strong>
                      {networkInfo.matchedLocation
                        ? `Đang kết nối Wi-Fi hợp lệ: ${networkInfo.matchedLocation.name}`
                        : 'Trạng thái mạng hiện tại của bạn'}
                    </strong>
                  </div>
                  <p className="holiday-wifi-status__meta">
                    IP hiện tại: <code>{networkInfo.ip || 'Chưa xác định'}</code>
                    {networkInfo.ip && !networkInfo.isPublic ? ' (Mạng nội bộ / Loopback)' : ''}
                  </p>
                </div>
                <div className="holiday-wifi-status__actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => refreshWifiNetwork(settings.wifiAttendance)}
                    disabled={detectingIp}
                  >
                    <i className={`fas fa-rotate${detectingIp ? ' fa-spin' : ''}`}></i> Kiểm tra mạng
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleCaptureCurrentIp}
                    disabled={detectingIp}
                  >
                    <i className="fas fa-location-crosshairs"></i> Lấy IP Wi-Fi hiện tại
                  </button>
                </div>
              </div>

              <div className="holiday-wifi-toggles">
                <label className="holiday-settings-check">
                  <input
                    type="checkbox"
                    checked={wifiAttendance.enabled}
                    onChange={event => updateWifiSettings(current => ({
                      ...current,
                      enabled: event.target.checked
                    }))}
                  />
                  <span>
                    <strong>Bật xác thực chấm công bằng Wi-Fi văn phòng (IP)</strong>
                    <small> Khi nhân viên kết nối đúng Wi-Fi công ty đã đăng ký, hệ thống xác nhận ngay mà không cần bật GPS.</small>
                  </span>
                </label>

                <label className="holiday-settings-check">
                  <input
                    type="checkbox"
                    checked={wifiAttendance.requireWifi}
                    disabled={!wifiAttendance.enabled}
                    onChange={event => updateWifiSettings(current => ({
                      ...current,
                      requireWifi: event.target.checked
                    }))}
                  />
                  <span>
                    <strong>Bắt buộc kết nối đúng Wi-Fi văn phòng mới được Check-in / Check-out</strong>
                    <small> Nếu bật, nhân viên dùng 4G hoặc mạng ngoài văn phòng sẽ không thể bấm chấm công online.</small>
                  </span>
                </label>
              </div>

              <div className="holiday-wifi-form-card">
                <h3>{editingWifiId ? 'Cập nhật điểm Wi-Fi văn phòng' : 'Thêm điểm Wi-Fi văn phòng / bưu cục'}</h3>
                <div className="holiday-wifi-form-grid">
                  <label>
                    <span>Tên điểm / Văn phòng *</span>
                    <input
                      type="text"
                      value={wifiForm.name}
                      onChange={event => setWifiForm(prev => ({ ...prev, name: event.target.value }))}
                      placeholder="VD: Văn phòng Hà Nội (HAN)"
                    />
                  </label>
                  <label>
                    <span>Tên Wi-Fi (SSID hiển thị)</span>
                    <input
                      type="text"
                      value={wifiForm.ssid}
                      onChange={event => setWifiForm(prev => ({ ...prev, ssid: event.target.value }))}
                      placeholder="VD: ECO_OFFICE_5G"
                    />
                  </label>
                  <label className="holiday-wifi-form-grid__full">
                    <span>Địa chỉ / Ghi chú</span>
                    <input
                      type="text"
                      value={wifiForm.address}
                      onChange={event => setWifiForm(prev => ({ ...prev, address: event.target.value }))}
                      placeholder="VD: Bưu cục Hà Nội / TP.HCM"
                    />
                  </label>
                  <label className="holiday-wifi-form-grid__full">
                    <span>Danh sách IP Public hoặc prefix IPv6 (/48 đến /128) — mỗi dòng 1 mục *</span>
                    <textarea
                      rows={3}
                      value={wifiForm.allowedIpsText}
                      onChange={event => setWifiForm(prev => ({ ...prev, allowedIpsText: event.target.value }))}
                      placeholder={'118.70.128.45\n2402:800:61c3:abcd::/64'}
                    />
                  </label>
                </div>
                <div className="holiday-wifi-form-actions">
                  <label className="holiday-settings-check" style={{ marginTop: 0 }}>
                    <input
                      type="checkbox"
                      checked={wifiForm.isActive}
                      onChange={event => setWifiForm(prev => ({ ...prev, isActive: event.target.checked }))}
                    />
                    <span>Đang hoạt động</span>
                  </label>
                  <div className="holiday-wifi-form-btns">
                    {editingWifiId && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setEditingWifiId(null)
                          setWifiForm(EMPTY_WIFI_FORM)
                        }}
                      >
                        Hủy sửa
                      </button>
                    )}
                    <button type="button" className="btn btn-primary" onClick={handleUpsertWifiLocation}>
                      <i className={`fas ${editingWifiId ? 'fa-check' : 'fa-plus'}`}></i>{' '}
                      {editingWifiId ? 'Cập nhật điểm Wi-Fi' : 'Thêm điểm Wi-Fi'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="holiday-wifi-list">
                <h3>Danh sách điểm Wi-Fi đã đăng ký ({wifiAttendance.locations.length})</h3>
                {wifiAttendance.locations.length === 0 ? (
                  <div className="holiday-settings-empty">
                    Chưa có điểm Wi-Fi văn phòng nào. Hãy kết nối Wi-Fi công ty và bấm &ldquo;Lấy IP Wi-Fi hiện tại&rdquo;.
                  </div>
                ) : (
                  wifiAttendance.locations.map(item => {
                    const isCurrentMatch = networkInfo.matchedLocation?.id === item.id
                    return (
                      <div className={`holiday-wifi-item${isCurrentMatch ? ' is-matched' : ''}`} key={item.id}>
                        <div className="holiday-wifi-item__info">
                          <div className="holiday-wifi-item__head">
                            <strong>{item.name}</strong>
                            {item.ssid && <span className="holiday-wifi-badge">SSID: {item.ssid}</span>}
                            <span className={`holiday-wifi-badge ${item.isActive ? 'is-active' : 'is-inactive'}`}>
                              {item.isActive ? 'Đang bật' : 'Tạm tắt'}
                            </span>
                            {isCurrentMatch && (
                              <span className="holiday-wifi-badge is-connected">
                                <i className="fas fa-check-circle"></i> Đang kết nối
                              </span>
                            )}
                          </div>
                          {item.address && <p className="holiday-wifi-item__addr">{item.address}</p>}
                          <div className="holiday-wifi-item__ips">
                            {item.allowedIps.map(ip => (
                              <code key={ip}>{ip}</code>
                            ))}
                          </div>
                        </div>
                        <div className="holiday-wifi-item__actions">
                          <button type="button" className="btn" onClick={() => handleEditWifiLocation(item)}>
                            <i className="fas fa-pen"></i> Sửa
                          </button>
                          <button
                            type="button"
                            className="btn btn-icon"
                            title="Xóa điểm Wi-Fi"
                            onClick={() => handleRemoveWifiLocation(item.id)}
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'penalties' && (
        <section className="holiday-settings-card" role="tabpanel">
          <div className="holiday-settings-penalty-toolbar">
            <button type="button" className="btn" onClick={addPenaltyCategory} disabled={loading}>
              <i className="fas fa-plus"></i> Thêm nội dung phạt
            </button>
            <button type="button" className="btn" onClick={resetPenaltyCategories} disabled={loading}>
              Khôi phục mặc định
            </button>
          </div>

          {loading ? (
            <div className="holiday-settings-empty">Đang tải cài đặt...</div>
          ) : (
            <div className="holiday-settings-penalty-list">
              <div className="holiday-settings-penalty-head">
                <span>Nội dung phạt</span>
                <span>Mức phạt (đ)</span>
                <span></span>
              </div>
              {penaltyCategories.map(item => (
                <div className="holiday-settings-penalty-row" key={item.key}>
                  <label className="mobile-field-label" htmlFor={`penalty-label-${item.key}`}>Nội dung phạt</label>
                  <input
                    id={`penalty-label-${item.key}`}
                    type="text"
                    value={item.label}
                    placeholder="Ví dụ: Đi muộn"
                    onChange={event => updatePenaltyCategory(item.key, 'label', event.target.value)}
                  />
                  <label className="mobile-field-label" htmlFor={`penalty-amount-${item.key}`}>Mức phạt (đ)</label>
                  <input
                    id={`penalty-amount-${item.key}`}
                    type="number"
                    min="0"
                    step="1000"
                    value={item.amount}
                    onChange={event => updatePenaltyCategory(item.key, 'amount', Math.max(0, Number(event.target.value || 0)))}
                  />
                  <button
                    type="button"
                    className="btn btn-icon"
                    title="Xóa hạng mục"
                    onClick={() => removePenaltyCategory(item.key)}
                    disabled={penaltyCategories.length <= 1}
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default HolidaySettings
