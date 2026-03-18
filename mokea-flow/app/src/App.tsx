import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react'
import './App.css'

interface Tab {
  id: string
  url: string
  title: string
  favicon: string
  customTitle?: string
}

interface HotBarItem {
  id: string
  url: string
  title: string
  favicon: string
}

interface ContextMenu {
  tabId: string
  x: number
  y: number
}

function getHost(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') }
  catch { return url }
}

function getFallbackFavicon(url: string): string {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`
  } catch { return '' }
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [hotbar, setHotbar] = useState<HotBarItem[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [urlFocused, setUrlFocused] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  // ─── Auto-hide sidebar ────────────────────────────────

  const showSidebar = useCallback(() => {
    setSidebarHidden(false)
    window.ipcRenderer.send('sidebar-toggle', true)
  }, [])

  const resetHideTimer = useCallback(() => {
    if (sidebarHidden) showSidebar()
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (urlFocused || ctxMenu || renaming) return
    hideTimer.current = setTimeout(() => {
      setSidebarHidden(true)
      window.ipcRenderer.send('sidebar-toggle', false)
    }, 4_000)
  }, [sidebarHidden, urlFocused, ctxMenu, renaming, showSidebar])

  useEffect(() => {
    resetHideTimer()
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => { setCtxMenu(null); resetHideTimer() }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu, resetHideTimer])

  useEffect(() => {
    if (renaming && renameRef.current) renameRef.current.focus()
  }, [renaming])

  // ─── IPC Listeners ────────────────────────────────────

  useEffect(() => {
    window.ipcRenderer.on('tabs-restored', (_e: unknown, data: {
      tabs: Tab[]; activeTabId: string; hotbar: HotBarItem[]
    }) => {
      setTabs(data.tabs)
      setActiveTabId(data.activeTabId)
      setHotbar(data.hotbar || [])
    })

    window.ipcRenderer.on('tab-updated', (_e: unknown, update: Partial<Tab> & { id: string }) => {
      setTabs(prev => prev.map(t =>
        t.id === update.id ? { ...t, ...update } : t
      ))
    })

    window.ipcRenderer.on('tab-switched', (_e: unknown, data: { id: string }) => {
      setActiveTabId(data.id)
    })

    window.ipcRenderer.on('hotbar-updated', (_e: unknown, items: HotBarItem[]) => {
      setHotbar(items)
    })
  }, [])

  // ─── Handlers ─────────────────────────────────────────

  const handleNavigate = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !inputValue.trim()) return
    const val = inputValue.trim()
    setInputValue('')
    const tab = await window.ipcRenderer.invoke('create-tab', val) as Tab
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    resetHideTimer()
  }

  const handleSwitchTab = (tabId: string) => {
    window.ipcRenderer.send('switch-tab', tabId)
    setActiveTabId(tabId)
    resetHideTimer()
  }

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    window.ipcRenderer.send('close-tab', tabId)
    setTabs(prev => prev.filter(t => t.id !== tabId))
    resetHideTimer()
  }

  const handleHotbarClick = async (url: string) => {
    const result = await window.ipcRenderer.invoke('hotbar-click', url) as {
      id: string; url?: string; title?: string; favicon?: string; existing: boolean
    }
    if (!result.existing) {
      setTabs(prev => [...prev, { id: result.id, url: result.url!, title: result.title!, favicon: result.favicon! }])
    }
    setActiveTabId(result.id)
    resetHideTimer()
  }

  const handleRemoveHotbar = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation()
    window.ipcRenderer.send('remove-from-hotbar', itemId)
    resetHideTimer()
  }

  // ─── Context Menu ─────────────────────────────────────

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  const ctxAddToHotbar = () => {
    if (!ctxMenu) return
    window.ipcRenderer.send('add-to-hotbar', ctxMenu.tabId)
    setCtxMenu(null)
  }

  const ctxRename = () => {
    if (!ctxMenu) return
    const tab = tabs.find(t => t.id === ctxMenu.tabId)
    setRenameValue(tab?.customTitle || tab?.title || '')
    setRenaming(ctxMenu.tabId)
    setCtxMenu(null)
  }

  const ctxDuplicate = async () => {
    if (!ctxMenu) return
    const result = await window.ipcRenderer.invoke('duplicate-tab', ctxMenu.tabId) as Tab | null
    if (result) {
      setTabs(prev => [...prev, result])
      setActiveTabId(result.id)
    }
    setCtxMenu(null)
  }

  const ctxCopyUrl = async () => {
    if (!ctxMenu) return
    const url = await window.ipcRenderer.invoke('get-tab-url', ctxMenu.tabId) as string
    navigator.clipboard.writeText(url)
    setCtxMenu(null)
  }

  const ctxCloseOthers = () => {
    if (!ctxMenu) return
    window.ipcRenderer.send('close-other-tabs', ctxMenu.tabId)
    setTabs(prev => prev.filter(t => t.id === ctxMenu.tabId))
    setActiveTabId(ctxMenu.tabId)
    setCtxMenu(null)
  }

  const ctxClose = () => {
    if (!ctxMenu) return
    window.ipcRenderer.send('close-tab', ctxMenu.tabId)
    setTabs(prev => prev.filter(t => t.id !== ctxMenu.tabId))
    setCtxMenu(null)
  }

  const handleRenameSubmit = (tabId: string) => {
    window.ipcRenderer.send('rename-tab', tabId, renameValue)
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, customTitle: renameValue.trim() || undefined, title: renameValue.trim() || t.title } : t
    ))
    setRenaming(null)
    resetHideTimer()
  }

  const activeTab = tabs.find(t => t.id === activeTabId)
  const getTabDisplay = (tab: Tab) => tab.customTitle || tab.title || getHost(tab.url)

  // URL info
  const urlInfo = (() => {
    if (!activeTab?.url) return { protocol: '', domain: '', full: '' }
    try {
      const u = new URL(activeTab.url)
      return {
        protocol: u.protocol.replace(':', ''),
        domain: u.hostname,
        full: u.hostname + u.pathname,
      }
    } catch {
      return { protocol: '', domain: activeTab.url, full: activeTab.url }
    }
  })()

  return (
    <>
      {/* ─── Top Area (hotbar + info bar) ─── */}
      <div className={`top-area ${sidebarHidden ? 'top-expanded' : ''}`}>
        <div className="hotbar">
          {hotbar.length > 0 ? hotbar.map(item => (
            <div
              key={item.id}
              className="hotbar-item"
              title={item.title || getHost(item.url)}
              onClick={() => handleHotbarClick(item.url)}
              onContextMenu={(e) => { e.preventDefault(); handleRemoveHotbar(e, item.id) }}
            >
              <img
                className="favicon"
                src={item.favicon || getFallbackFavicon(item.url)}
                alt=""
                draggable={false}
              />
              <span className="hotbar-label">{item.title || getHost(item.url)}</span>
            </div>
          )) : (
            <div className="hotbar-empty">
              <span>⌘⇧H to pin pages here</span>
            </div>
          )}
        </div>

      </div>

      {/* ─── Info Bar (below hotbar, above webview) ─── */}
      <div className={`info-bar ${sidebarHidden ? 'info-expanded' : ''}`}>
        {urlInfo.protocol && (
          <span className={`info-secure ${urlInfo.protocol}`}>
            {urlInfo.protocol === 'https' ? '🔒 ' : '⚠ '}{urlInfo.protocol}
          </span>
        )}
        <span className="info-domain">
          <strong>{getHost(activeTab?.url || '')}</strong>
          {activeTab?.url && (() => {
            try { return new URL(activeTab.url).pathname }
            catch { return '' }
          })() !== '/' && (
            <span>{(() => { try { return new URL(activeTab.url).pathname } catch { return '' } })()}</span>
          )}
        </span>
      </div>

      {/* ─── Sidebar ─── */}
      <aside
        className={`sidebar ${sidebarHidden ? 'hidden' : ''}`}
        onMouseMove={resetHideTimer}
        onClick={resetHideTimer}
      >
        <div className="drag-region" />

        <div className="sidebar-header">
          <span className="logo-text">MOKEA FLOW</span>
        </div>

        <div className="url-bar">
          <input
            type="text"
            placeholder="Enter URL + Enter = New Tab"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleNavigate}
            onFocus={() => { setUrlFocused(true); resetHideTimer() }}
            onBlur={() => { setUrlFocused(false); resetHideTimer() }}
            spellCheck={false}
          />
        </div>

        <div className="tab-list">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => handleSwitchTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
            >
              <img
                className="favicon-sm"
                src={tab.favicon || getFallbackFavicon(tab.url)}
                alt=""
                draggable={false}
              />
              {renaming === tab.id ? (
                <input
                  ref={renameRef}
                  className="rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(tab.id)
                    if (e.key === 'Escape') { setRenaming(null); resetHideTimer() }
                  }}
                  onBlur={() => handleRenameSubmit(tab.id)}
                  onClick={(e) => e.stopPropagation()}
                  spellCheck={false}
                />
              ) : (
                <span className="tab-title">{getTabDisplay(tab)}</span>
              )}
              <button
                className="tab-close"
                onClick={(e) => handleCloseTab(e, tab.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="current-url" title={activeTab?.url}>
            {activeTab ? getHost(activeTab.url) : ''}
          </div>
          <div className="footer-hint">⌘⇧H = Pin</div>
        </div>
      </aside>

      {/* Reveal zone */}
      <div
        className={`sidebar-reveal ${sidebarHidden ? 'active' : ''}`}
        onMouseEnter={() => { showSidebar(); resetHideTimer() }}
      />

      {/* Context Menu */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-item" onClick={ctxAddToHotbar}>Add to HotBar</div>
          <div className="ctx-item" onClick={ctxRename}>Rename Tab</div>
          <div className="ctx-item" onClick={ctxDuplicate}>Duplicate Tab</div>
          <div className="ctx-item" onClick={ctxCopyUrl}>Copy URL</div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={ctxCloseOthers}>Close Other Tabs</div>
          <div className="ctx-item danger" onClick={ctxClose}>Close Tab</div>
        </div>
      )}
    </>
  )
}

export default App
